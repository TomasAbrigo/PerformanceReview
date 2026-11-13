import { EMAIL_DOMAIN, FIRST_NAMES, LAST_NAMES } from "./catalog";
import type { Rng } from "./rng";

export interface PersonName {
  firstName: string;
  lastName: string;
}

export function fullName(name: PersonName): string {
  return `${name.firstName} ${name.lastName}`;
}

export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** "Ruiz, Ana": how Bamboo renders supervisor / reportsTo. */
export function lastFirst(name: PersonName): string {
  return `${name.lastName}, ${name.firstName}`;
}

function emailSlug(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Hands out unique names, emails and employee numbers. */
export class IdentityPool {
  private readonly usedNames = new Set<string>();
  private readonly usedEmails = new Set<string>();
  private nextEmployeeNumber = 10000;

  constructor(private readonly rng: Rng) {}

  /** A person name not used before (use `reserveName` for deliberate clones). */
  newName(): PersonName {
    for (;;) {
      const name = {
        firstName: this.rng.pick(FIRST_NAMES),
        lastName: this.rng.pick(LAST_NAMES),
      };
      if (!this.usedNames.has(fullName(name))) {
        this.usedNames.add(fullName(name));
        return name;
      }
    }
  }

  /** A last name that, with this first name, does not collide with anyone. */
  newLastName(firstName: string): string {
    for (;;) {
      const lastName = this.rng.pick(LAST_NAMES);
      const key = fullName({ firstName, lastName });
      if (!this.usedNames.has(key)) {
        this.usedNames.add(key);
        return lastName;
      }
    }
  }

  /** Unique work email: first.last@domain, with a numeric suffix on clashes. */
  newEmail(name: PersonName): string {
    const base = `${emailSlug(name.firstName)}.${emailSlug(name.lastName)}`;
    let candidate = `${base}@${EMAIL_DOMAIN}`;
    for (let n = 2; this.usedEmails.has(candidate); n++) {
      candidate = `${base}${n}@${EMAIL_DOMAIN}`;
    }
    this.usedEmails.add(candidate);
    return candidate;
  }

  /** Legajo: increasing 5-digit text, never equal to a Bamboo id. */
  newEmployeeNumber(): string {
    this.nextEmployeeNumber += this.rng.int(1, 9);
    return String(this.nextEmployeeNumber);
  }
}

/**
 * A plausible typo of a full name that matches nobody in `known`: accents
 * dropped, two letters swapped in the last name, or a letter lost.
 */
export function misspell(
  name: PersonName,
  rng: Rng,
  known: ReadonlySet<string>,
): string {
  const full = fullName(name);
  const last = name.lastName;
  const swapAt = last.length >= 4 ? rng.int(1, last.length - 3) : 1;
  const swapped = `${last.slice(0, swapAt)}${last[swapAt + 1] ?? ""}${last[swapAt]}${last.slice(swapAt + 2)}`;
  const options = [
    stripAccents(full),
    `${name.firstName} ${swapped}`,
    `${name.firstName} ${last.slice(0, -1)}`,
    `${name.firstName.slice(0, -1)} ${last}`,
  ];
  const first = rng.int(0, options.length - 1);
  for (let i = 0; i < options.length; i++) {
    const candidate = options[(first + i) % options.length];
    if (candidate !== full && !known.has(candidate)) return candidate;
  }
  return `${full}.`;
}
