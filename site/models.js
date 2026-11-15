/**
 * Shared data contracts. These are JSDoc types; the app still runs directly as ESM JavaScript.
 * @typedef {{id: string, name: string, adult: boolean}} Person
 * @typedef {Pick<Person, 'id'|'name'>} SharedPerson
 * @typedef {{id: string, name: string, address?: string, checkIn?: string, checkOut?: string, confirmation?: string, notes?: string}} Lodging
 * @typedef {{id: string, title: string, date: string, time?: string, endTime?: string, location?: string, mapUrl?: string, notes?: string, dining?: boolean, museum?: boolean, adultOnly?: boolean, attendeeIds: string[]}} Activity
 * @typedef {{id: string, name: string, destination?: string, startDate: string, endDate: string, peopleIds: string[], lodging: Lodging[], activities: Activity[], shareToken: string|null}} Trip
 * @typedef {{rev: number, people: Person[], trips: Trip[]}} Store
 * @typedef {{people: Person[], trips: Trip[]}} ExportedData
 * @typedef {{trip: Pick<Trip, 'name'|'destination'|'startDate'|'endDate'|'lodging'|'activities'>, people: SharedPerson[]}} SharedView
 * @typedef {'all'|'activities'|'dining'|'museum'} ActivityFilter
 * @typedef {'dining'|'museum'} ActivityType
 * @typedef {{title: string, location: string, category: string, dining: boolean|null, museum: boolean|null, mapUrl: string, warning?: string}} MapsPlace
 */
export {};
