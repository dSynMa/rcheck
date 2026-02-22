export type State = Record<string, Record<string, any>>

export interface Transition {
    "___get-supply___"?: boolean,
    sender: string,
    send: string,
    receivers: string[]
}

export interface Step {
    depth: number,
    inboundTransition?: Transition
    "___DEADLOCK___"?: boolean,
    "___LTOL___"?: Record<string, string>,
    "___STUCK___"?: boolean,
    "___LOOP___"?: boolean,
    state: State
    transitions: Transition[]
}

export function renderStep(trace: Step[], x: Step) {
    const last: Step = trace[x.depth > 0 ? x.depth - 1 : 0];
    var render: State = {};
    Object.keys(x.state).forEach(agent => {
        const filtered = Object.keys(x.state[agent])
        .filter(k => k != "myself" && (k === "**state**" || !k.startsWith("**")))
        .filter(k => x.depth === 0 || x.state[agent][k] != last.state[agent][k]);
        if (filtered.length > 0) { 
            render[agent] = Object.fromEntries(filtered.map(k => [k, x.state[agent][k]]))
        }
    });
    return render;
}

