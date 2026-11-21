---------------- MODULE IcareSecurity ----------------
EXTENDS Naturals, FiniteSets

CONSTANTS Origins, ApprovedInferenceOrigins, ProjectValues,
          SecretValues, PayloadValues

VARIABLES projectStore, sessionSecrets, persistentSecrets,
          approvedPayloads, outbound, userRequestedInference,
          serviceWorkerEnabled

vars == <<projectStore, sessionSecrets, persistentSecrets,
          approvedPayloads, outbound, userRequestedInference,
          serviceWorkerEnabled>>

Init ==
  /\ projectStore = {}
  /\ sessionSecrets = {}
  /\ persistentSecrets = {}
  /\ approvedPayloads = {}
  /\ outbound = {}
  /\ userRequestedInference = FALSE
  /\ serviceWorkerEnabled \in BOOLEAN

CreateOrEditProject(data) ==
  /\ data \in ProjectValues
  /\ projectStore' = projectStore \cup {data}
  /\ UNCHANGED <<sessionSecrets, persistentSecrets, approvedPayloads,
                 outbound, userRequestedInference, serviceWorkerEnabled>>

SetSessionSecret(secret) ==
  /\ secret \in SecretValues
  /\ sessionSecrets' = sessionSecrets \cup {secret}
  /\ UNCHANGED <<projectStore, persistentSecrets, approvedPayloads,
                 outbound, userRequestedInference, serviceWorkerEnabled>>

ApproveInferencePayload(payload) ==
  /\ payload \in PayloadValues
  /\ approvedPayloads' = approvedPayloads \cup {payload}
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 outbound, userRequestedInference, serviceWorkerEnabled>>

RequestInferenceConsent ==
  /\ userRequestedInference = FALSE
  /\ userRequestedInference' = TRUE
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 approvedPayloads, outbound, serviceWorkerEnabled>>

RequestInference(origin, payload) ==
  /\ origin \in ApprovedInferenceOrigins
  /\ payload \in approvedPayloads
  /\ userRequestedInference = TRUE
  /\ outbound' = outbound \cup {<<origin, payload, "inference", "consented">>}
  /\ userRequestedInference' = FALSE
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 approvedPayloads, serviceWorkerEnabled>>

DisableServiceWorker ==
  /\ serviceWorkerEnabled = TRUE
  /\ serviceWorkerEnabled' = FALSE
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 approvedPayloads, outbound, userRequestedInference>>

Next ==
  \/ \E data \in ProjectValues : CreateOrEditProject(data)
  \/ \E secret \in SecretValues : SetSessionSecret(secret)
  \/ \E payload \in PayloadValues : ApproveInferencePayload(payload)
  \/ RequestInferenceConsent
  \/ \E origin \in ApprovedInferenceOrigins, payload \in PayloadValues :
       RequestInference(origin, payload)
  \/ DisableServiceWorker

TypeOK ==
  /\ projectStore \subseteq ProjectValues
  /\ sessionSecrets \subseteq SecretValues
  /\ persistentSecrets = {}
  /\ approvedPayloads \subseteq PayloadValues
  /\ outbound \subseteq (Origins \X PayloadValues \X {"inference"} \X {"consented"})
  /\ userRequestedInference \in BOOLEAN
  /\ serviceWorkerEnabled \in BOOLEAN

NoPersistentCredentials == persistentSecrets = {}
InferenceRequiresConsent ==
  \A item \in outbound : item[4] = "consented"
OnlyApprovedPayloadsEgress ==
  \A item \in outbound : item[2] \in approvedPayloads
InferenceDestinationApproved ==
  \A item \in outbound : item[1] \in ApprovedInferenceOrigins

Spec == Init /\ [][Next]_vars
THEOREM Spec => []TypeOK
THEOREM Spec => []NoPersistentCredentials
THEOREM Spec => []InferenceRequiresConsent
THEOREM Spec => []OnlyApprovedPayloadsEgress
THEOREM Spec => []InferenceDestinationApproved
=============================================================================
