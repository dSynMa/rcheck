export type State = Record<string, any>

export interface Transition {
    "___get-supply___"?: boolean,
    sender: string,
    send: string,
    receivers: string[]
}

export interface Step {
    depth: number,
    inboundTransition?: Transition
    "__LTOL__"?: Record<string, string>,
    "___STUCK___"?: boolean,
    "___LOOP___"?: boolean,
    state: State
    transitions: Transition[]
}

export function renderStep(trace: Step[], x: Step) {
    if (x.depth === 0) { return x.state; }
    var last = trace[x.depth - 1];
    var render: State = {};
    Object.keys(x.state).forEach(agent => {
        const s = Object.keys(x.state[agent])
        .filter(k => (k === "**state**" || !k.startsWith("**")))
        .filter(k => x.state[agent][k] != last.state[agent][k]);
        if (s.length > 0) { render[agent] = s }
    });
    return render;
}

export function formatStep(render: State) {
    return `
<table>
${Object.keys(render).sort().map(agent => (
    `<tr key=${agent}>
        <td>${agent}:</td>
        <td><span>${
        Object.keys(render[agent])
        .sort()
        .filter(k => (k === "**state**") || !k.startsWith("**"))
        .map(k => `${(k === "**state**") ? "<em>state</em>" : k}: ${render[agent][k]}`)
        .filter(s => s.trim().length > 0)
        .join(", ")
        }</span></td>
    </tr>`
)).join("\n")}
</table>`
}

export function formatTransition(t: Transition) {
    const isSupplyGet = t.hasOwnProperty("___get-supply___");
    return `<table>
      <tr><td><em>${isSupplyGet ? "Supplier" : "Sender"}: </em></td>
      <td>${t.sender}</td></tr>
      <tr><td><em>Command: </em></td><td><pre>${t.send}</pre></td></tr>
      <tr><td><em>${isSupplyGet ? "Getter" : "Receivers"}: </em></td>
      <td>${t.receivers.join(", ")}</td></tr>
    </table>`
  }
