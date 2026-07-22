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
<!--
  YG Portal: login is "Login with code" (OTP) ONLY. The password login form, the
  "Forgot your password? / Recover" link (lives in LoginPasswordForm, no longer rendered),
  the login-with-password toggle, and "Continue as a guest" are all intentionally removed.
-->
<script lang="ts">
  import { type IntlString, Status } from '@hcengineering/platform'
  import { signupStore } from '@hcengineering/analytics-providers'
  import { onMount } from 'svelte'

  import LoginOtpForm from './LoginOtpForm.svelte'
  import { LoginInfo } from '@hcengineering/account-client'

  export let navigateUrl: string | undefined = undefined
  export let signUpDisabled = false
  // Kept for parent (LoginApp) prop compatibility; login is code-only regardless.
  export let useOTP = true
  export let email: string | undefined = undefined
  export let caption: IntlString | undefined = undefined
  export let subtitle: string | undefined = undefined
  export let onLogin: ((loginInfo: LoginInfo | null, status: Status) => void | Promise<void>) | undefined = undefined

  onMount(() => {
    signupStore.setSignUpFlow(false)
  })
</script>

<LoginOtpForm {navigateUrl} {signUpDisabled} {email} {caption} {subtitle} {onLogin} />
