// Public surface of billing. Other modules import only from here (docs/SAAS_PLAN.md §4 rule 3).
export type { Cap, Feature, Head } from './catalogue.js';
export {
  accountForNewInstitute,
  assertCanAddHead,
  assertFeature,
  getEntitlements,
} from './service.js';
