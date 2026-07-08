import type { UserMindFact } from "../types.js";

function factBlob(fact: UserMindFact): string {
  return `${fact.fact_key} ${fact.fact_value}`.toLowerCase();
}

export function combinedFactBlob(facts: UserMindFact[]): string {
  return facts.map(factBlob).join(" ");
}

export function isRetiredOrElderProfile(facts: UserMindFact[]): boolean {
  return facts.some((fact) =>
    /\b(retired|pension|widow|widower|grandmother|grandfather|grandma|grandpa|primary school teacher|school teacher)\b/.test(
      factBlob(fact)
    )
  );
}

export function hasPrivateFinanceSignal(facts: UserMindFact[]): boolean {
  return facts.some((fact) =>
    /\b(private|secret|track.*fund|track my fund|little fund|savings|tuition|pension|money.*track|fund tracking|rs\s?\d)\b/.test(
      factBlob(fact)
    )
  );
}

export function isRemoteWorkerProfile(facts: UserMindFact[]): boolean {
  return facts.some((fact) =>
    /\b(remote|work from home|wfh|working from home|eu company|europe|overseas client|digital nomad)\b/.test(
      factBlob(fact)
    )
  );
}

export function hasFamilyMoneyPressure(facts: UserMindFact[]): boolean {
  const blob = combinedFactBlob(facts);
  return /\b(bleeding me dry|family.*pay|brother.*loan|dad expects|mum cries|bank account.*flat|flat despite|good income.*flat|wedding.*cost|fianc[eé]e|guilt trip|calls me selfish|pay off.*loan|family money|sandwich generation)\b/.test(
    blob
  );
}

export function hasBoundaryGoal(facts: UserMindFact[]): boolean {
  return facts.some((fact) =>
    /\b(boundar(y|ies)|say no|push back|selfish|stand up to|draw a line)\b/.test(factBlob(fact))
  );
}
