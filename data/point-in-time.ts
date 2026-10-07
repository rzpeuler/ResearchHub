/** Availability instant for an exchange daily close after the Shanghai close. */
export function dailyCloseAvailableAt(priceDate: string): string {
  return new Date(`${priceDate}T15:00:00+08:00`).toISOString()
}
