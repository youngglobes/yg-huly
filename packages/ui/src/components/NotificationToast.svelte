<!--
//
// Copyright © 2024 Hardcore Engineering Inc.
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
//
-->

<script lang="ts">
  import type { ComponentType } from 'svelte'
  import { fade } from 'svelte/transition'
  import Button from './Button.svelte'
  import Icon from './Icon.svelte'
  import CheckCircle from './icons/CheckCircle.svelte'
  import Close from './icons/Close.svelte'
  import Info from './icons/Info.svelte'
  import { NotificationSeverity } from './notifications/NotificationSeverity'

  export let onClose: (() => void) | undefined = undefined
  export let severity: NotificationSeverity | undefined = undefined
  export let title: string

  const getIcon = (): ComponentType | undefined => {
    switch (severity) {
      case NotificationSeverity.Success:
        return CheckCircle
      case NotificationSeverity.Error:
      case NotificationSeverity.Info:
      case NotificationSeverity.Warning:
        return Info
    }
  }

  $: icon = getIcon()
</script>

<div
  class="toastCard"
  class:sev-success={severity === NotificationSeverity.Success}
  class:sev-error={severity === NotificationSeverity.Error}
  class:sev-info={severity === NotificationSeverity.Info}
  class:sev-warning={severity === NotificationSeverity.Warning}
  in:fade out:fade
>
  <div class="flex-between">
    <div class="flex-row-center">
      {#if icon}
        <div
          class="mr-2"
          class:icon-success={severity === NotificationSeverity.Success}
          class:icon-error={severity === NotificationSeverity.Error}
          class:icon-info={severity === NotificationSeverity.Info}
          class:icon-warning={severity === NotificationSeverity.Warning}
        >
          <Icon {icon} size="medium" />
        </div>
      {/if}
      <span class="overflow-label fs-bold text-base caption-color">{title}</span>
    </div>
    {#if onClose !== undefined}
      <Button icon={Close} kind="ghost" size="small" dataId={'btnNotifyClose'} on:click={onClose} />
    {/if}
  </div>

  <div class="content">
    <slot name="content" />
  </div>

  {#if $$slots.buttons}
    <div class="flex-between gap-2">
      <slot name="buttons" />
    </div>
  {/if}
</div>

<style lang="scss">
  .toastCard {
    --toast-accent: var(--theme-popup-divider);
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    margin: 0.5rem 0.75rem;
    padding: 0.875rem 1rem 0.875rem 1.125rem;
    min-width: 20rem;
    max-width: 26rem;
    color: var(--theme-caption-color);
    background-color: var(--theme-popup-color);
    border: 1px solid var(--theme-popup-divider);
    border-radius: 0.75rem;
    box-shadow: var(--theme-popup-shadow);

    // Left accent bar carries the severity color across the whole card, not just the icon.
    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--toast-accent);
    }
    &.sev-success {
      --toast-accent: var(--theme-won-color);
    }
    &.sev-error {
      --toast-accent: var(--theme-lost-color);
    }
    &.sev-info {
      --toast-accent: var(--primary-color-skyblue);
    }
    &.sev-warning {
      --toast-accent: var(--theme-warning-color);
    }

    .icon-success {
      color: var(--theme-won-color);
    }
    .icon-error {
      color: var(--theme-lost-color);
    }
    .icon-info {
      color: var(--primary-color-skyblue);
    }
    .icon-warning {
      color: var(--theme-warning-color);
    }

    .content {
      flex-grow: 1;
      margin: 0.5rem 0 0;
      color: var(--theme-content-color);
      font-size: 0.8125rem;
      line-height: 1.45;
    }

    :global(.buttons-group),
    .flex-between.gap-2 {
      margin-top: 0.875rem;
    }
  }
</style>
