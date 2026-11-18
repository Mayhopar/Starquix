# OperationNotice

`import { OperationNotice } from '@/components/ui'`

Scoped operation feedback, composed from Row and Button. Supply curated title and
optional detail, never raw exceptions, URLs, response bodies, or file paths.

```tsx
<OperationNotice title="Project layouts are unavailable."
  detail="Retry to load the latest layouts."
  action={{label: 'Retry', onClick: refresh, busy: refreshing}} />
```

`action` is optional; its supported callback, busy/disabled flags, and lifetime
belong to the feature. This primitive owns no timers, retries, error parsing, or
state. It uses a polite live region by default; use `urgency="assertive"` only
when immediate interruption is necessary. Text wraps. Do not pair its busy
button with another spinner for the same operation. Do not use for routine save
or storage status. Supply an action only when the owning feature supports safe recovery.

Its bordered row keeps the text 8px inside the border (`px-2`): a notice at the body's 8px puts its text on the window's 16px edge; never wrap it in another box.

`links` = pages that explain or fix the problem (a build log, GitHub settings): ghost buttons before the action, opened in the browser (`window.open`; desktop main hands http(s) to the system browser). Never blue text links under the box.
