export interface ModifiedDateRange {
  modifiedFrom?: number;
  modifiedTo?: number;
}

const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

export function modifiedDateRangeFromInputs(
  fromValue: string,
  toValue: string,
  now = Date.now(),
): ModifiedDateRange {
  const modifiedFrom = parseLocalDate(fromValue);
  const toStart = parseLocalDate(toValue);

  if (modifiedFrom !== undefined && toStart !== undefined && modifiedFrom > toStart) {
    throw new Error('The From date must be on or before the To date.');
  }

  const range: ModifiedDateRange = {};
  if (modifiedFrom !== undefined) range.modifiedFrom = modifiedFrom;
  if (toStart !== undefined) {
    range.modifiedTo = nextLocalDay(toStart) - 1;
  } else if (modifiedFrom !== undefined) {
    range.modifiedTo = now;
  }
  return range;
}

function parseLocalDate(value: string): number | undefined {
  if (!value) return undefined;
  const match = value.match(DATE_INPUT);
  if (!match) throw new Error('Enter dates in YYYY-MM-DD format.');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    throw new Error('Enter a valid calendar date.');
  }
  return date.getTime();
}

function nextLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + 1);
  return date.getTime();
}
