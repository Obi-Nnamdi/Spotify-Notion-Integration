import { DateTime } from 'luxon';

/**
 * Turn a date object into a standard format string.
 * @param date Date object.
 * @returns A string of the date in `date` formatted in the "Weekday, Month Day, Hour:Minute:Second AM/PM TimeZone" format.
 */
export function standardFormatDate(date: DateTime<boolean>): string {
    return date.toLocaleString(
        {
            weekday: 'short', month: 'short',
            day: '2-digit', hour: '2-digit',
            minute: '2-digit', second: '2-digit',
            timeZoneName: 'short'
        });
}

/**
 * Chunk an array.
 * 
 * @param array Array to chunk.
 * @param chunkSize Size of each chunk. Each chunk is guaranteed to be at least this size.
 * @returns Array split into chunks of size <= chunkSize.
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

/**
 * Intersect two arrays.
 * 
 * @param a First array.
 * @param b Second array.
 * @returns Intersection between a and b. Equality between elements is compared objectively (i.e. with ===).
 */
export function arrayIntersect<T>(a: T[], b: T[]): T[] {
    const bSet = new Set(b);
    return a.filter(x => bSet.has(x));
}

/**
 * Subtract two arrays.
 * 
 * @param a First array.
 * @param b Second array.
 * @returns Difference a - b. Equality between elements is compared objectively (i.e. with ===).
 */
export function arrayDifference<T>(a: T[], b: T[]): T[] {
    const bSet = new Set(b);
    return a.filter(x => !bSet.has(x));
}

/**
 * Union two arrays.
 * 
 * @param a First array.
 * @param b Second array.
 * @returns Union between a and b. Equality between elements is compared objectively (i.e. with ===).
 */
export function arrayUnion<T>(a: T[], b: T[]): T[] {
    return Array.from(new Set([...a, ...b]));
}