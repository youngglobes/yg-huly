<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
  export let size: 'small' | 'medium' | 'large' = 'medium'
</script>

<div
  class="ring-spinner-container {size === 'small' ? 'size-small' : size === 'medium' ? 'size-medium' : 'size-large'}"
>
  <div class="loader"></div>
</div>

<style lang="scss">
  .ring-spinner-container {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.1875rem;
    height: 2.1875rem;
  }

  .size-small {
    width: 1.75rem;
    height: 1.75rem;
  }

  .size-large {
    width: 3.5rem;
    height: 3.5rem;
  }

  .loader {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background: conic-gradient(from 0deg, transparent 0deg, var(--theme-trans-color) 300deg);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 0.1875rem), #000 calc(100% - 0.1875rem));
    mask: radial-gradient(farthest-side, transparent calc(100% - 0.1875rem), #000 calc(100% - 0.1875rem));
    animation: ring-spin 0.8s linear infinite;
  }

  .size-small .loader {
    width: 1.125rem;
    height: 1.125rem;
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 0.125rem), #000 calc(100% - 0.125rem));
    mask: radial-gradient(farthest-side, transparent calc(100% - 0.125rem), #000 calc(100% - 0.125rem));
  }

  .size-large .loader {
    width: 2.25rem;
    height: 2.25rem;
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 0.25rem), #000 calc(100% - 0.25rem));
    mask: radial-gradient(farthest-side, transparent calc(100% - 0.25rem), #000 calc(100% - 0.25rem));
  }

  @keyframes ring-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
