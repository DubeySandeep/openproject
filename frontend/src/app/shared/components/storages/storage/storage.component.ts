// -- copyright
// OpenProject is an open source project management software.
// Copyright (C) 2012-2023 the OpenProject GmbH
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 3.
//
// OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
// Copyright (C) 2006-2013 Jean-Philippe Lang
// Copyright (C) 2010-2013 the ChiliProject Team
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
//
// See COPYRIGHT and LICENSE files for more details.
//++

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import {
  HttpErrorResponse,
} from '@angular/common/http';
import {
  BehaviorSubject,
  Observable,
  of,
  throwError,
} from 'rxjs';
import {
  catchError,
  filter,
  map,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { CookieService } from 'ngx-cookie-service';
import { v4 as uuidv4 } from 'uuid';

import { HalResource } from 'core-app/features/hal/resources/hal-resource';
import { IFileLink, IFileLinkOriginData } from 'core-app/core/state/file-links/file-link.model';
import { IPrepareUploadLink, IStorage } from 'core-app/core/state/storages/storage.model';
import { FileLinksResourceService } from 'core-app/core/state/file-links/file-links.service';
import {
  fileLinkViewError,
  nextcloud,
  storageAuthorizationError,
  storageConnected,
  storageFailedAuthorization,
} from 'core-app/shared/components/storages/storages-constants.const';
import { CurrentUserService } from 'core-app/core/current-user/current-user.service';
import { UntilDestroyedMixin } from 'core-app/shared/helpers/angular/until-destroyed.mixin';
import { I18nService } from 'core-app/core/i18n/i18n.service';
import { StorageActionButton } from 'core-app/shared/components/storages/storage-information/storage-action-button';
import {
  StorageInformationBox,
} from 'core-app/shared/components/storages/storage-information/storage-information-box';
import { OpModalService } from 'core-app/shared/components/modal/modal.service';
import {
  FilePickerModalComponent,
} from 'core-app/shared/components/storages/file-picker-modal/file-picker-modal.component';
import { IHalResourceLink } from 'core-app/core/state/hal-resource';
import {
  LocationPickerModalComponent,
} from 'core-app/shared/components/storages/location-picker-modal/location-picker-modal.component';
import { ToastService } from 'core-app/shared/components/toaster/toast.service';
import { StorageFilesResourceService } from 'core-app/core/state/storage-files/storage-files.service';
import { OpUploadService } from 'core-app/core/upload/upload.service';
import { IUploadLink } from 'core-app/core/state/storage-files/upload-link.model';
import { IStorageFile } from 'core-app/core/state/storage-files/storage-file.model';
import { TimezoneService } from 'core-app/core/datetime/timezone.service';
import { PathHelperService } from 'core-app/core/path-helper/path-helper.service';
import {
  UploadConflictModalComponent,
} from 'core-app/shared/components/storages/upload-conflict-modal/upload-conflict-modal.component';
import {
  NextcloudFileUploadResponse,
  NextcloudUploadFile,
  NextcloudUploadService,
} from 'core-app/shared/components/storages/upload/nextcloud-upload.service';
import { LocationData, UploadData } from 'core-app/shared/components/storages/storage/interfaces';
import isNotNull from 'core-app/core/state/is-not-null';
import compareId from 'core-app/core/state/compare-id';
import isHttpResponse from 'core-app/core/upload/is-http-response';
import isNewResource from 'core-app/features/hal/helpers/is-new-resource';

@Component({
  selector: 'op-storage',
  templateUrl: './storage.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: OpUploadService, useClass: NextcloudUploadService }],
})
export class StorageComponent extends UntilDestroyedMixin implements OnInit, OnDestroy {
  @Input() public resource:HalResource;

  @Input() public storage:IStorage;

  @Input() public allowUploading = true;

  @Input() public allowLinking = true;

  @ViewChild('hiddenFileInput') public filePicker:ElementRef<HTMLInputElement>;

  fileLinks$:Observable<IFileLink[]>;

  disabled = false;

  storageType:string;

  storageErrors = new BehaviorSubject<StorageInformationBox[]>([]);

  draggingOverDropZone = false;

  dragging = 0;

  private isLoggedIn = false;

  private readonly storageTypeMap:Record<string, string> = {};

  text = {
    infoBox: {
      fileLinkErrorHeader: this.i18n.t('js.storages.information.live_data_error'),
      fileLinkErrorContent: (storageType:string):string => this.i18n.t('js.storages.information.live_data_error_description', { storageType }),
      connectionErrorHeader: (storageType:string):string => this.i18n.t('js.storages.no_connection', { storageType }),
      connectionErrorContent: (storageType:string):string => this.i18n.t('js.storages.information.connection_error', { storageType }),
      authorizationFailureHeader: (storageType:string):string => this.i18n.t('js.storages.login_to', { storageType }),
      authorizationFailureContent: (storageType:string):string => this.i18n.t('js.storages.information.not_logged_in', { storageType }),
      loginButton: (storageType:string):string => this.i18n.t('js.storages.login', { storageType }),
    },
    actions: {
      linkExisting: this.i18n.t('js.storages.link_existing_files'),
      uploadFile: this.i18n.t('js.storages.upload_files'),
    },
    toast: {
      successFileLinksCreated: (count:number):string => this.i18n.t('js.storages.file_links.success_create', { count }),
      uploadFailed: (fileName:string):string => this.i18n.t('js.storages.file_links.upload_error.default', { fileName }),
      uploadFailedForbidden: (fileName:string):string => this.i18n.t('js.storages.file_links.upload_error.403', { fileName }),
      uploadFailedSizeLimit:
        (fileName:string, storageType:string):string => this.i18n.t(
          'js.storages.file_links.upload_error.413',
          {
            fileName,
            storageType,
          },
        ),
      uploadFailedQuota: (fileName:string):string => this.i18n.t('js.storages.file_links.upload_error.507', { fileName }),
      linkingAfterUploadFailed:
        (fileName:string, workPackageId:string):string => this.i18n.t(
          'js.storages.file_links.link_uploaded_file_error',
          {
            fileName,
            workPackageId,
          },
        ),
      draggingManyFiles: (storageType:string):string => this.i18n.t('js.storages.files.dragging_many_files', { storageType }),
      uploadingLabel: this.i18n.t('js.label_upload_notification'),
    },
    dropBox: {
      uploadLabel: this.i18n.t('js.storages.upload_files'),
      dropFiles: ():string => this.i18n.t('js.storages.drop_files', { name: this.storage.name }),
      dropClickFiles: ():string => this.i18n.t('js.storages.drop_or_click_files', { name: this.storage.name }),
    },
    emptyList: ():string => this.i18n.t('js.storages.file_links.empty', { storageType: this.storageType }),
    openStorage: ():string => this.i18n.t('js.storages.open_storage', { storageType: this.storageType }),
    nextcloud: this.i18n.t('js.storages.types.nextcloud'),
  };

  public get storageFilesLocation():string {
    return this.storage._links.open.href;
  }

  private get addFileLinksHref():string {
    if (isNewResource(this.resource)) {
      return this.pathHelperService.fileLinksPath();
    }

    return (this.resource.$links as unknown&{ addFileLink:IHalResourceLink }).addFileLink.href;
  }

  private onGlobalDragLeave:(_event:DragEvent) => void = (_event) => {
    this.dragging = Math.max(this.dragging - 1, 0);
    this.cdRef.detectChanges();
  };

  private onGlobalDragEnd:(_event:DragEvent) => void = (_event) => {
    this.dragging = 0;
    this.cdRef.detectChanges();
  };

  private onGlobalDragEnter:(_event:DragEvent) => void = (_event) => {
    this.dragging += 1;
    this.cdRef.detectChanges();
  };

  constructor(
    private readonly i18n:I18nService,
    private readonly cdRef:ChangeDetectorRef,
    private readonly toastService:ToastService,
    private readonly cookieService:CookieService,
    private readonly uploadService:OpUploadService,
    private readonly opModalService:OpModalService,
    private readonly timezoneService:TimezoneService,
    private readonly pathHelperService:PathHelperService,
    private readonly currentUserService:CurrentUserService,
    private readonly fileLinkResourceService:FileLinksResourceService,
    private readonly storageFilesResourceService:StorageFilesResourceService,
  ) {
    super();
  }

  ngOnInit():void {
    this.initializeStorageTypes();

    this.storageType = this.storageTypeMap[this.storage._links.type.href];

    this.disabled = this.storage._links.authorizationState.href !== storageConnected;

    this.fileLinks$ = this.fileLinkResourceService.collection(this.collectionKey);

    this.currentUserService.isLoggedIn$
      .pipe(this.untilDestroyed())
      .subscribe((isLoggedIn) => { this.isLoggedIn = isLoggedIn; });

    this.fileLinks$
      .pipe(this.untilDestroyed())
      .subscribe((fileLinks) => {
        if (isNewResource(this.resource)) {
          this.resource.fileLinks = { elements: fileLinks.map((a) => a._links?.self) };
        }

        this.storageErrors.next(this.getStorageErrors(fileLinks));
      });

    document.body.addEventListener('dragenter', this.onGlobalDragEnter);
    document.body.addEventListener('dragleave', this.onGlobalDragLeave);
    document.body.addEventListener('dragend', this.onGlobalDragEnd);
    document.body.addEventListener('drop', this.onGlobalDragEnd);
  }

  ngOnDestroy():void {
    document.body.removeEventListener('dragenter', this.onGlobalDragEnter);
    document.body.removeEventListener('dragleave', this.onGlobalDragLeave);
    document.body.removeEventListener('dragend', this.onGlobalDragEnd);
    document.body.removeEventListener('drop', this.onGlobalDragEnd);
  }

  public removeFileLink(fileLink:IFileLink):void {
    this.fileLinkResourceService.remove(this.collectionKey, fileLink)
      .subscribe(
        () => { /* Do nothing */ },
        (error:HttpErrorResponse) => this.toastService.addError(error),
      );
  }

  public openLinkFilesDialog():void {
    this.fileLinks$
      .pipe(take(1))
      .subscribe((fileLinks) => {
        const locals = {
          storageType: this.storage._links.type.href,
          storageName: this.storage.name,
          storageLink: this.storage._links.self,
          addFileLinksHref: this.addFileLinksHref,
          collectionKey: this.collectionKey,
          location: '/',
          fileLinks,
        };
        this.opModalService.show<FilePickerModalComponent>(FilePickerModalComponent, 'global', locals);
      });
  }

  public triggerFileInput():void {
    this.filePicker.nativeElement.click();
  }

  public onFilePickerChanged():void {
    const fileList = this.filePicker.nativeElement.files;
    if (fileList === null) return;

    this.storageFileUpload(fileList[0]);
    // reset file input, so that selecting the same file again triggers a change
    this.filePicker.nativeElement.value = '';
  }

  private storageFileUpload(file:File):void {
    this.selectUploadLocation()
      .pipe(
        switchMap((data) => this.resolveUploadConflicts(file, data.files, data.location)),
      )
      .subscribe((data) => {
        this.uploadAndCreateFileLink(data);
      });
  }

  private selectUploadLocation():Observable<LocationData> {
    const locals = {
      storageType: this.storage._links.type.href,
      storageName: this.storage.name,
      storageLink: this.storage._links.self,
      location: '/',
    };

    return this.opModalService.show<LocationPickerModalComponent>(LocationPickerModalComponent, 'global', locals)
      .pipe(
        switchMap((modal) => modal.closingEvent),
        filter((modal) => modal.submitted),
        take(1),
        map((modal) => ({ location: modal.location, files: modal.filesAtLocation })),
      );
  }

  private resolveUploadConflicts(file:File, storageFiles:IStorageFile[], location:string):Observable<UploadData> {
    const conflict = storageFiles.find((f) => f.name === file.name);
    if (!conflict) {
      return of({ file, location, overwrite: null });
    }

    return this.opModalService.show<UploadConflictModalComponent>(UploadConflictModalComponent, 'global', { fileName: file.name })
      .pipe(
        switchMap((modal) => modal.closingEvent),
        filter((modal) => modal.overwrite !== null),
        take(1),
        map((modal) => ({ file, location, overwrite: modal.overwrite })),
      );
  }

  private uploadAndCreateFileLink(data:UploadData):void {
    let isUploadError = false;

    this.storageFilesResourceService
      .uploadLink(this.uploadResourceLink(data.file.name, data.location))
      .pipe(
        switchMap((link) => this.uploadAndNotify(link, data.file, data.overwrite)),
        catchError((error) => {
          isUploadError = true;
          return throwError(error);
        }),
        switchMap((uploadResponse) => this.createFileLinkData(data.file, uploadResponse)),
        tap((fileLinkCreationData) => {
          // Update the file link list of this storage only in case of a linked file got updated
          if (fileLinkCreationData === null) {
            this.fileLinkResourceService.updateCollection(this.fileLinkSelfLink).subscribe();
          }
        }),
        filter(isNotNull),
        switchMap((file) => this.fileLinkResourceService.addFileLinks(
          this.collectionKey,
          this.addFileLinksHref,
          this.storage._links.self,
          [file],
        )),
      )
      .subscribe(
        (collection) => {
          this.toastService.addSuccess(this.text.toast.successFileLinksCreated(collection.count));
        },
        (error) => {
          if (isUploadError) {
            this.handleUploadError(error as HttpErrorResponse, data.file.name);
          } else {
            this.toastService.addError(this.text.toast.linkingAfterUploadFailed(data.file.name, this.resource.id as string));
          }

          console.error(error);
        },
      );
  }

  private handleUploadError(error:HttpErrorResponse, fileName:string):void {
    switch (error.status) {
      case 403:
        this.toastService.addError(this.text.toast.uploadFailedForbidden(fileName));
        break;
      case 413:
        this.toastService.addError(this.text.toast.uploadFailedSizeLimit(fileName, this.storageType));
        break;
      case 507:
        this.toastService.addError(this.text.toast.uploadFailedQuota(fileName));
        break;
      default:
        this.toastService.addError(this.text.toast.uploadFailed(fileName));
    }
  }

  private uploadAndNotify(link:IUploadLink, file:File, overwrite:boolean|null):Observable<NextcloudFileUploadResponse> {
    const { href } = link._links.destination;
    const uploadFiles:NextcloudUploadFile[] = [{ file, overwrite }];
    const observable = this.uploadService.upload<NextcloudFileUploadResponse>(href, uploadFiles)[0];
    this.toastService.addUpload(this.text.toast.uploadingLabel, [[file, observable]]);

    return observable
      .pipe(
        filter(isHttpResponse),
        map((ev) => ev.body),
        map((data) => {
          if (data === null) {
            throw new Error('Upload data is null.');
          }

          return data;
        }),
      );
  }

  private createFileLinkData(file:File, response:NextcloudFileUploadResponse):Observable<IFileLinkOriginData|null> {
    return this.fileLinks$
      .pipe(
        take(1),
        map((fileLinks) => {
          const existingFileLink = fileLinks.find((l) => compareId(l.originData.id, response.file_id));
          if (existingFileLink) {
            return null;
          }

          const now = this.timezoneService.parseDate(new Date()).toISOString();
          return ({
            id: response.file_id,
            name: response.file_name,
            mimeType: file.type,
            size: file.size,
            createdAt: now,
            lastModifiedAt: now,
          });
        }),
      );
  }

  private uploadResourceLink(fileName:string, location:string):IPrepareUploadLink {
    const project = (this.resource.project as unknown&{ id:string }).id;
    const link = this.storage._links.prepareUpload.filter((value) => project === value.payload.projectId.toString());
    if (link.length === 0) {
      throw new Error('Cannot upload to this storage. Missing permissions in project.');
    }

    return {
      href: link[0].href,
      method: link[0].method,
      title: link[0].title,
      payload: {
        projectId: link[0].payload.projectId,
        parent: location,
        fileName,
      },
    };
  }

  private getStorageErrors(fileLinks:IFileLink[]):StorageInformationBox[] {
    if (!this.isLoggedIn) {
      return [];
    }

    switch (this.storage._links.authorizationState.href) {
      case storageFailedAuthorization:
        return [this.failedAuthorizationInformation];
      case storageAuthorizationError:
        return [this.authorizationErrorInformation];
      case storageConnected:
        if (fileLinks.filter((fileLink) => fileLink._links.permission?.href === fileLinkViewError).length > 0) {
          this.disabled = true;
          return [this.fileLinkErrorInformation];
        }
        return [];
      default:
        return [];
    }
  }

  private get failedAuthorizationInformation():StorageInformationBox {
    return new StorageInformationBox(
      'import',
      this.text.infoBox.authorizationFailureHeader(this.storageType),
      this.text.infoBox.authorizationFailureContent(this.storageType),
      [new StorageActionButton(
        this.text.infoBox.loginButton(this.storageType),
        () => {
          if (this.storage._links.authorize) {
            const nonce = uuidv4();
            this.setAuthorizationCallbackCookie(nonce);
            window.location.href = StorageComponent.authorizationFailureActionUrl(
              this.storage._links.authorize.href,
              nonce,
            );
          } else {
            throw new Error('Authorize link is missing!');
          }
        },
      )],
    );
  }

  private get authorizationErrorInformation():StorageInformationBox {
    return new StorageInformationBox(
      'remove-link',
      this.text.infoBox.connectionErrorHeader(this.storageType),
      this.text.infoBox.connectionErrorContent(this.storageType),
      [],
    );
  }

  private get fileLinkErrorInformation():StorageInformationBox {
    return new StorageInformationBox(
      'error',
      this.text.infoBox.fileLinkErrorHeader,
      this.text.infoBox.fileLinkErrorContent(this.storageType),
      [],
    );
  }

  private get collectionKey():string {
    return isNewResource(this.resource) ? 'new' : this.fileLinkSelfLink;
  }

  private get fileLinkSelfLink():string {
    const fileLinks = this.resource.fileLinks as unknown&{ href:string };
    return `${fileLinks.href}?filters=[{"storage":{"operator":"=","values":["${this.storage.id}"]}}]`;
  }

  private setAuthorizationCallbackCookie(nonce:string):void {
    this.cookieService.set(`oauth_state_${nonce}`, window.location.href, {
      path: '/',
    });
  }

  private static authorizationFailureActionUrl(baseUrl:string, nonce:string):string {
    return `${baseUrl}&state=${nonce}`;
  }

  private initializeStorageTypes() {
    this.storageTypeMap[nextcloud] = this.text.nextcloud;
  }

  public onDropFiles(event:DragEvent):void {
    if (event.dataTransfer === null) return;

    this.draggingOverDropZone = false;
    this.dragging = 0;

    const files = event.dataTransfer.files;
    if (files.length !== 1) {
      this.toastService.addError(this.text.toast.draggingManyFiles(this.storageType));
      return;
    }

    this.storageFileUpload(files[0]);
  }

  public onDragOver(event:DragEvent):void {
    if (event.dataTransfer !== null && containsFiles(event.dataTransfer)) {
      // eslint-disable-next-line no-param-reassign
      event.dataTransfer.dropEffect = 'copy';
      this.draggingOverDropZone = true;
    }
  }

  public onDragLeave(_event:DragEvent):void {
    this.draggingOverDropZone = false;
  }
}

function containsFiles(dataTransfer:DataTransfer):boolean {
  return dataTransfer.types.indexOf('Files') >= 0;
}
