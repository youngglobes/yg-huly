<!--
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021, 2022 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { getMetadata, setMetadata } from '@hcengineering/platform'
  import presentation from '@hcengineering/presentation'
  import {
    Location,
    Popup,
    Scroller,
    deviceOptionsStore as deviceInfo,
    fetchMetadataLocalStorage,
    getCurrentLocation,
    location,
    setMetadataLocalStorage,
    themeStore
  } from '@hcengineering/ui'
  import workbench from '@hcengineering/workbench'
  import { onDestroy, onMount } from 'svelte'
  import Auth from './Auth.svelte'
  import Confirmation from './Confirmation.svelte'
  import ConfirmationSend from './ConfirmationSend.svelte'
  import CreateWorkspaceForm from './CreateWorkspaceForm.svelte'
  import Join from './Join.svelte'
  import AutoJoin from './AutoJoin.svelte'
  import LoginForm from './LoginForm.svelte'
  import ProvidersOnlyForm from './ProvidersOnlyForm.svelte'
  import PasswordRequest from './PasswordRequest.svelte'
  import PasswordRestore from './PasswordRestore.svelte'
  import SelectWorkspace from './SelectWorkspace.svelte'
  import SignupForm from './SignupForm.svelte'
  import LoginTfaForm from './LoginTfaForm.svelte'
  import LoginIcon from './icons/LoginIcon.svelte'
  import { Pages, getAccount, pages } from '..'
  import login from '../plugin'

  import AdminWorkspaces from './AdminWorkspaces.svelte'
  import ChangePassword from './ChangePassword.svelte'

  export let page: Pages = 'signup'

  const signUpDisabled = getMetadata(login.metadata.DisableSignUp) ?? false
  const wsCreationDisabled = getMetadata(login.metadata.DisableWorkspaceCreation) ?? false
  const localLoginHidden = getMetadata(login.metadata.HideLocalLogin) ?? false
  const useOTP = getMetadata(presentation.metadata.MailUrl) != null && getMetadata(presentation.metadata.MailUrl) !== ''
  let navigateUrl: string | undefined
  let tfaToken: string | undefined = undefined

  onDestroy(location.subscribe(updatePageLoc))

  function updatePageLoc (loc: Location): void {
    const token = getMetadata(presentation.metadata.Token)
    page = (loc.path[1] as Pages) ?? (token != null ? 'selectWorkspace' : 'login')
    if (page === 'join' && loc.query?.autoJoin !== undefined) {
      page = 'autoJoin'
    }
    // YG fork: workspace creation is disabled, so the create route is not reachable even by URL.
    if (page === 'createWorkspace' && wsCreationDisabled) {
      page = token != null ? 'selectWorkspace' : 'login'
    }

    const allowedUnauthPages: Pages[] = [
      'login',
      'signup',
      'password',
      'recovery',
      'join',
      'autoJoin',
      'confirm',
      'confirmationSend',
      'auth',
      'tfa'
    ]
    if (token === undefined ? !allowedUnauthPages.includes(page) : !pages.includes(page)) {
      const account = fetchMetadataLocalStorage(login.metadata.LastAccount)
      page = account != null ? 'login' : 'signup'
    }

    navigateUrl = loc.query?.navigateUrl ?? undefined
    tfaToken = loc.query?.token ?? undefined
  }

  async function chooseToken (): Promise<void> {
    if (page === 'auth') {
      // token handled by auth page
      return
    } else if (page === 'autoJoin') {
      // there's a separate workflow for auto join
      return
    }

    if (getMetadata(presentation.metadata.Token) == null) {
      const lastAccount = fetchMetadataLocalStorage(login.metadata.LastAccount)
      if (lastAccount != null) {
        try {
          const loginInfo = await getAccount(false)
          if (loginInfo != null) {
            setMetadata(presentation.metadata.Token, loginInfo.token)
            setMetadataLocalStorage(login.metadata.LoginAccount, loginInfo.account)
            updatePageLoc(getCurrentLocation())
          }
        } catch (err: any) {
          // do nothing
        }
      }
    }
  }

  onMount(chooseToken)
</script>

{#if page === 'admin'}
  <AdminWorkspaces />
{:else}
  <div
    class="theme-dark w-full h-full backd"
    class:paneld={$deviceInfo.docWidth <= 768}
    class:white={!$themeStore.dark}
  >
    <div class="bg-image clear-mins" class:back={$deviceInfo.docWidth > 768} class:p-4={$deviceInfo.docWidth > 768}>
      <div
        style:position="fixed"
        style:left={$deviceInfo.docWidth <= 480 ? '.75rem' : '1.75rem'}
        style:top={'calc(3rem + var(--huly-top-indent, 0rem))'}
        class="flex-row-center"
      >
        <LoginIcon /><span class="fs-title ml-2">{getMetadata(workbench.metadata.PlatformTitle)}</span>
      </div>

      <div class="panel-base" class:panel={$deviceInfo.docWidth > 768} class:white={!$themeStore.dark}>
        <Scroller padding={'1rem 0'}>
          <div class="form-content">
            {#if page === 'login'}
              {#if localLoginHidden}
                <ProvidersOnlyForm />
              {:else}
                <LoginForm {navigateUrl} {signUpDisabled} {useOTP} />
              {/if}
            {:else if page === 'signup'}
              <SignupForm {navigateUrl} {signUpDisabled} {localLoginHidden} {useOTP} />
            {:else if page === 'createWorkspace'}
              <CreateWorkspaceForm />
            {:else if page === 'password'}
              <PasswordRequest {signUpDisabled} />
            {:else if page === 'recovery'}
              <PasswordRestore />
            {:else if page === 'selectWorkspace'}
              <SelectWorkspace {navigateUrl} />
            {:else if page === 'join'}
              <Join />
            {:else if page === 'autoJoin'}
              <AutoJoin />
            {:else if page === 'confirm'}
              <Confirmation />
            {:else if page === 'confirmationSend'}
              <ConfirmationSend />
            {:else if page === 'auth'}
              <Auth />
            {:else if page === 'changePassword'}
              <ChangePassword />
            {:else if page === 'tfa'}
              <LoginTfaForm {navigateUrl} token={tfaToken} on:back={() => (page = 'login')} />
            {/if}
          </div>
        </Scroller>
      </div>

      <Popup />
    </div>
  </div>
{/if}

<style lang="scss">
  .backd {
    position: relative;
    // Dark ground with soft YG-yellow glows: a stronger one top-left and a softer one bottom-right,
    // matching the brand background. No image - pure gradient.
    background:
      radial-gradient(46% 42% at 14% 14%, rgba(var(--yg-brand-rgb), 0.22), transparent 60%),
      radial-gradient(42% 40% at 88% 92%, rgba(var(--yg-brand-rgb), 0.14), transparent 62%),
      #0d0d0b;

    .bg-image {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
    }
    &.paneld {
      background: transparent;

      .panel-base {
        padding-top: 5rem;
        padding-bottom: 1rem;
        width: 100%;
      }
    }
  }

  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    width: 50%;
    height: 100%;
    min-width: 35rem;
    max-width: 41rem;
    background: rgba(28, 28, 30, 0.55);
    mix-blend-mode: normal;
    box-shadow: 0 20px 80px rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(157.855px);
    border-radius: 1rem;

    &::after {
      overflow: hidden;
      position: absolute;
      content: '';
      inset: 0;
      background: radial-gradient(161.92% 96.11% at 11.33% 3.89%, rgba(40, 40, 44, 0.85) 0%, rgba(18, 18, 20, 0.92) 100%);
      border-radius: 1rem;
      z-index: -1;
    }
    &::before {
      position: absolute;
      content: '';
      inset: 0;
      padding: 1px;
      background: linear-gradient(180deg, rgba(var(--yg-brand-rgb), 0.35), rgba(255, 255, 255, 0.10)) border-box;
      -webkit-mask:
        linear-gradient(#000 0 0) content-box,
        linear-gradient(#000 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      border-radius: 1rem;
      transform: rotate(180deg);
      transition: opacity 0.15s var(--timing-main);
      opacity: 0.7;
    }
  }
  .backd.paneld::after,
  .panel::after {
    overflow: hidden;
    position: absolute;
    content: '';
    inset: 0;
    background: radial-gradient(161.92% 96.11% at 11.33% 3.89%, rgba(40, 40, 44, 0.85) 0%, rgba(18, 18, 20, 0.92) 100%);
    z-index: -1;
  }
  .panel::after {
    border-radius: 1rem;
  }
  .form-content {
    display: flex;
    flex-direction: column;
    justify-content: center;
    flex-grow: 1;
    height: max-content;
  }
</style>
