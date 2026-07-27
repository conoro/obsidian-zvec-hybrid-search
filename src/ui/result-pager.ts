export interface ResultPage<T> {
  items: T[];
  shown: number;
  remaining: number;
}

export class ResultPager<T> {
  private items: T[] = [];
  private shown = 0;

  reset(items: T[]): void {
    this.items = items;
    this.shown = 0;
  }

  clear(): void {
    this.items = [];
    this.shown = 0;
  }

  next(batchSize: number): ResultPage<T> {
    const size = Math.max(1, Math.round(batchSize));
    const end = Math.min(this.items.length, this.shown + size);
    const items = this.items.slice(this.shown, end);
    this.shown = end;
    return {
      items,
      shown: this.shown,
      remaining: this.items.length - this.shown,
    };
  }
}
