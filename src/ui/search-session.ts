export class SearchSession {
  private generation = 0;
  private query: string | null = null;

  get hasActiveSearch(): boolean {
    return this.query !== null;
  }

  begin(query: string): number {
    this.query = query;
    this.generation += 1;
    return this.generation;
  }

  invalidateIfInputChanged(input: string): boolean {
    if (this.query === null || input.trim() === this.query) return false;
    this.clear();
    return true;
  }

  clear(): void {
    this.query = null;
    this.generation += 1;
  }

  isCurrent(generation: number, query: string): boolean {
    return generation === this.generation && query === this.query;
  }
}
