#-- copyright
# OpenProject is an open source project management software.
# Copyright (C) 2012-2023 the OpenProject GmbH
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License version 3.
#
# OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
# Copyright (C) 2006-2013 Jean-Philippe Lang
# Copyright (C) 2010-2013 the ChiliProject Team
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License
# as published by the Free Software Foundation; either version 2
# of the License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program; if not, write to the Free Software
# Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
#
# See COPYRIGHT and LICENSE files for more details.
#++

require 'spec_helper'

describe 'Enterprise Edition token domain', js: true do
  let(:current_user) { create(:admin) }
  let(:ee_token) { Rails.root.join("spec/fixtures/ee_tokens/v2_1_user_localhost_3001.token").read }

  before do
    allow(User).to receive(:current).and_return current_user
  end

  shared_context 'when uploading a token' do
    before do
      visit '/admin/enterprise'

      fill_in "enterprise_token[encoded_token]", with: ee_token

      click_on "Save"
    end
  end

  describe 'initial upload' do
    context 'with correct domain', with_settings: { host_name: 'localhost:3001' } do
      it_behaves_like 'when uploading a token' do
        it 'saves the token' do
          expect(body).to have_text 'Successful update.'
        end

        it 'shows the token info' do
          expect(page).to have_selector('[data-qa-selector="ee-active-trial-email"]', text: 'operations@openproject.com')
        end
      end
    end

    context 'with incorrect domain', with_settings: { host_name: 'localhost:3000' } do
      it_behaves_like 'when uploading a token' do
        it "shows an invalid domain error" do
          expect(body).to have_text "Domain is invalid."
        end
      end
    end
  end

  context 'with an active token', with_settings: { host_name: 'localhost:3001' } do
    before do
      allow(EnterpriseToken).to receive(:current).and_return(EnterpriseToken.new(encoded_token: ee_token))

      visit '/admin/enterprise'
    end

    shared_context 'when replacing a token' do
      let(:new_token) { raise 'define me!' }

      before do
        click_on "Replace your current support token"

        fill_in "enterprise_token[encoded_token]", with: new_token

        click_on "Save"
      end
    end

    it 'shows the current token info' do
      expect(page).to have_selector('[data-qa-selector="ee-active-trial-email"]', text: 'operations@openproject.com')
    end

    describe 'replacing the token' do
      context 'with correct domain' do
        it_behaves_like 'when replacing a token' do
          let(:new_token) { ee_token }

          it 'updates the token' do
            expect(body).to have_text 'Successful update.'
          end
        end
      end

      context 'with incorrect domain' do
        it_behaves_like 'when replacing a token' do
          let(:new_token) { Rails.root.join("spec/fixtures/ee_tokens/v2_1_user_localhost_3000.token").read }

          it 'shows an invalid domain error' do
            expect(body).to have_text 'Domain is invalid.'
          end

          it "shows the new token's info" do
            expect(page).to have_selector('[data-qa-selector="ee-active-trial-domain"]', text: 'localhost:3000')
          end

          it "but doesn't save the new token" do
            visit '/admin/enterprise'

            expect(body).to have_text 'localhost:3001'
          end
        end
      end
    end
  end
end
