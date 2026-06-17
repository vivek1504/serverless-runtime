export class Deque<T> {
  private buf: (T | undefined)[];
  private head = 0;
  private tail = 0;
  private count = 0;

  constructor(initialCapacity = 16) {
    this.buf = new Array(initialCapacity);
  }

  get length(): number {
    return this.count;
  }

  push(item: T): void {
    if (this.count === this.buf.length) {
      this.grow();
    }
    this.buf[this.tail] = item;
    this.tail = (this.tail + 1) % this.buf.length;
    this.count++;
  }

  shift(): T | undefined {
    if (this.count === 0) return undefined;
    const item = this.buf[this.head];
    this.buf[this.head] = undefined;
    this.head = (this.head + 1) % this.buf.length;
    this.count--;
    return item;
  }

  toArray(): T[] {
    const result: T[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buf[(this.head + i) % this.buf.length] as T;
    }
    return result;
  }

  private grow(): void {
    const newCap = this.buf.length * 2;
    const newBuf: (T | undefined)[] = new Array(newCap);
    for (let i = 0; i < this.count; i++) {
      newBuf[i] = this.buf[(this.head + i) % this.buf.length];
    }
    this.buf = newBuf;
    this.head = 0;
    this.tail = this.count;
  }
}
