// Pattern for doing an async action exactly once even if it's called from
// multiple locations with async yields in the middle.
export class AsyncOnce {
  private queued_: ((value?: {} | PromiseLike<{}>) => void)[];
  private asyncAction_: ((value?: {} | PromiseLike<{}>) => any) | null;
  private hasValue_: boolean | undefined;
  private value_: string | undefined;
  private isDoing_: boolean | undefined;

  constructor(asyncAction: ((value?: {} | PromiseLike<{}>) => any)) {
    this.queued_ = [];
    this.asyncAction_ = asyncAction;
  }

  async do() {
    if (this.hasValue_)
      return this.value_;

    if (this.isDoing_)
      return new Promise(resolve => this.queued_.push(resolve));

    this.isDoing_ = true;
    if (!this.asyncAction_)
      throw 'Something went wrong. This should never happen.';
    this.value_ = await this.asyncAction_();
    this.hasValue_ = true;
    this.isDoing_ = false;

    for (let resolve of this.queued_) {
      resolve();
    }
    delete this.queued_;
    this.asyncAction_ = null;

    return this.value_;
  }
}
