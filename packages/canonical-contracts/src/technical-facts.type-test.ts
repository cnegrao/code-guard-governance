import type {TechnicalFact,TechnicalFactTransport} from './technical-facts.ts';
const valid:TechnicalFact={objectKind:'DATA_ELEMENT',field:'dataType.nativeType',value:'varchar(100)'};
// @ts-expect-error Structural kind is a closed domain enum, not any string.
const wrongStructural:TechnicalFact={objectKind:'DATA_ASSET',field:'structuralKind',value:'varchar'};
// @ts-expect-error A native datatype is textual, never a number.
const wrongValue:TechnicalFact={objectKind:'DATA_ELEMENT',field:'dataType.nativeType',value:42};
// @ts-expect-error No arbitrary field paths.
const wrongField:TechnicalFact={objectKind:'DATA_ELEMENT',field:'custom.anything',value:'x'};
// @ts-expect-error The transport cannot supply a tenant or policy.
const tenant:TechnicalFactTransport={organisationId:'untrusted',candidateId:'c',fact:valid,support:{assertionIds:[],evidenceIds:[]},sourceAttribute:{code:'field'}};
void [valid,wrongStructural,wrongValue,wrongField,tenant];
