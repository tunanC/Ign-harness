/** Type declarations for Tauri v2 API.
 *
 *  @tauri-apps/api provides its own types for window, invoke, etc.
 *  No custom globals needed — all native interaction uses:
 *    import { getCurrentWindow } from '@tauri-apps/api/window'
 *    import { invoke } from '@tauri-apps/api/core'
 */

import 'react';

declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}
