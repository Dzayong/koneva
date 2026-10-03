# Third-party image assets

Downloaded locally under `dashboard/public/`; never hotlinked. Both are under the free [Pexels License](https://www.pexels.com/license/) (free to use, modify, and host; no attribution required; not resold unmodified as stock). Neither is a paid/Pexels+ asset — Pexels has no paid tier, every photo on the site carries this same license.

| File | Source | Creator | License | Downloaded |
|---|---|---|---|---|
| `auth-bg-login.jpg` | https://www.pexels.com/photo/vibrant-abstract-purple-waves-background-29067690/ | Steve A Johnson | Pexels License (free) | 2026-10-02 |
| `auth-bg-signup.jpg` | https://www.pexels.com/photo/dynamic-abstract-3d-render-with-vibrant-colors-30004057/ | Steve A Johnson | Pexels License (free) | 2026-10-02 |

Both downloaded at 2560px wide via Pexels' own `auto=compress` CDN parameter (`https://images.pexels.com/photos/<id>/pexels-photo-<id>.jpeg?auto=compress&cs=tinysrgb&w=2560`), which already produced files under 300 KB (`auth-bg-login.jpg` ≈148 KB, `auth-bg-signup.jpg` ≈55 KB) with no further re-encoding needed. No watermark on either (Pexels does not watermark free downloads). Used as full-bleed `<AuthShell>` backgrounds with a ~40% dark overlay (`bg-black/40`) so form text stays readable; see `dashboard/src/components/auth/auth-shell.tsx`.
