import { redirect } from 'next/navigation'

/** /settings has no content of its own; General is the sensible landing spot. */
export default function SettingsIndexPage() {
  redirect('/settings/general')
}
