export interface TransitionConfig<S extends string> {
  target: S;
  guard?: () => boolean;
  action?: () => void;
}

export interface StateConfig<S extends string, E extends string> {
  onEnter?: () => void;
  onExit?: () => void;
  transitions?: Partial<Record<E, TransitionConfig<S>>>;
}

export interface StateMachineOptions {
  logTransitions?: boolean;
}

export class StateMachine<S extends string, E extends string> {
  private currentState: S;
  private readonly logTransitions: boolean;

  constructor(
    private readonly states: Record<S, StateConfig<S, E>>,
    initialState: S,
    options: StateMachineOptions = {},
  ) {
    if (!(initialState in states)) {
      throw new Error(`Unknown initial state: ${initialState}`);
    }
    this.currentState = initialState;
    this.logTransitions = options.logTransitions ?? false;
  }

  getState(): S {
    return this.currentState;
  }

  send(event: E): boolean {
    const from = this.currentState;
    const transition = this.states[from].transitions?.[event];
    if (!transition || (transition.guard && !transition.guard())) {
      return false;
    }

    const destination = this.states[transition.target];
    if (!destination) {
      throw new Error(`Unknown transition target: ${transition.target}`);
    }

    this.states[from].onExit?.();
    transition.action?.();
    this.currentState = transition.target;
    destination.onEnter?.();

    if (this.logTransitions) {
      console.log(`[SM] ${from} --${event}--> ${this.currentState}`);
    }
    return true;
  }
}
