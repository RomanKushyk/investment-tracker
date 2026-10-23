// The federated providers this pool can carry. The trigger matches a username's prefix against them
// case-INSENSITIVELY: that case is undocumented and a first federated sign-in has been reported
// lower-cased. The `identities` attribute carries the name as the template writes it. A test holds
// this to the template's `ProviderName`, which renders through a `!Ref` and would otherwise rename
// silently.
export const GOOGLE = 'Google';
export const PROVIDERS = [GOOGLE];
