import type { UserMindFact } from "../types.js";

function factBlob(fact: UserMindFact): string {
  return `${fact.fact_key} ${fact.fact_value}`.toLowerCase();
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
