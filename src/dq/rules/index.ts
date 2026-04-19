import { z } from 'zod';

import { CheckType } from '../../config/schema.js';
import { AllowedValuesRule } from './allowedValues.js';
import { EmailRule } from './email.js';
import { MaxLengthRule } from './maxLength.js';
import { MaxRule, MinRule } from './minMax.js';
import { NotNullRule } from './notNull.js';
import { PatternRule } from './pattern.js';
import { UkPostcodeRule } from './ukPostcode.js';
import { UniqueRule } from './unique.js';
import type { Rule } from './types.js';

export type BuiltInCheckType = z.infer<typeof CheckType>;

export const BUILT_IN_RULES: Readonly<Record<BuiltInCheckType, Rule>> = Object.freeze({
  notNull: new NotNullRule(),
  unique: new UniqueRule(),
  pattern: new PatternRule(),
  email: new EmailRule(),
  ukPostcode: new UkPostcodeRule(),
  maxLength: new MaxLengthRule(),
  min: new MinRule(),
  max: new MaxRule(),
  allowedValues: new AllowedValuesRule(),
});

export { AllowedValuesRule } from './allowedValues.js';
export { EmailRule } from './email.js';
export { MaxLengthRule } from './maxLength.js';
export { MaxRule, MinRule } from './minMax.js';
export { NotNullRule } from './notNull.js';
export { PatternRule } from './pattern.js';
export { UkPostcodeRule } from './ukPostcode.js';
export { UniqueRule } from './unique.js';
export type { Rule, RuleViolation } from './types.js';
