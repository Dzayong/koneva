# Personal dashboard design

The personal dashboard uses a quiet light canvas, a navy navigation rail, and emerald actions. Light mode is the default; the existing theme switch retains dark mode and system preference support.

## Palette

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#F8FAFC` | `#101720` |
| Text | `#0F172A` | `#E8EEF5` |
| Card | `#FFFFFF` | `#18222F` |
| Navigation | `#0F172A` | `#0C131E` |
| Primary action | `#047857` + white text | `#34D399` + `#09251E` text |
| Muted text | `#526176` | `#A7B5C7` |
| Success accent | `#10B981` | `#10B981` |

The requested emerald is retained as a success accent. Primary buttons use a darker emerald in light mode so small white labels remain legible. A 60/30/10 balance guides the visual hierarchy, rather than forcing every screen into literal area percentages. Status colors remain semantic (red for failure, amber for attention).

## Typography

Inter is loaded as a variable font through `next/font/google` and served locally by Next.js after the build. The build needs access to Google's font hosts; browsers do not fetch fonts from Google. Body text uses weight 500, metric figures and compact labels 550, and headings 600. Thin and heavy bold styling has been removed from the dashboard and welcome page. Tabular numerals keep message counts, timestamps, and metrics aligned. The Tailwind font token points to `--font-inter`, fixing the former circular `--font-sans` reference.

## Layout and interaction

Navigation remains visible while scrolling on desktop and moves into the existing drawer on mobile. A constrained content width and `min-width: 0` on the main column keep dense views usable. Primary controls have larger targets, navigation includes `aria-current` and keyboard focus indicators, and the header no longer claims a live connection without a connection signal.

Motion follows the restraint of [Form Studio's button interaction on Awwwards](https://www.awwwards.com/inspiration/button-animation-form-studio) and the short ease-out guidance in [Awwwards' mobile performance collection](https://assets.awwwards.com/brainfood-mobile-performance-vol3.pdf). These references informed timing and feedback, not copied artwork or layouts: 150ms control feedback, 180ms navigation transitions, 200ms page entrances, and 300ms chart transitions. Page entrances travel only 6px. Reduced-motion preferences disable page movement, chart animation, ring animation, welcome-page reveals, and CSS transitions.

## Review checklist

- Review `/login`, `/welcome`, `/`, `/devices`, `/messages`, `/contacts`, `/analytics`, and `/settings` at desktop and phone widths.
- Switch light/dark themes, check table overflow and chart labels, and navigate using the keyboard.
- Enable the operating system's reduced-motion setting and confirm navigation and data remain available immediately.
- Use `npm run lint`, `npx tsc --noEmit`, and `npm run build` from `dashboard/` for static and production checks.
