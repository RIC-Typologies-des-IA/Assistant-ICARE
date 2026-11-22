---------------- MODULE IcareSecurity ----------------
EXTENDS Naturals, FiniteSets

CONSTANTS Origins, ApprovedInferenceOrigins, ProjectValues,
          SecretValues, EncryptedCredentialValues, PayloadValues

VARIABLES projectStore, sessionSecrets, persistentSecrets,
          encryptedCredentialVault, cryptoKeyPresent,
          approvedPayloads, outbound, userRequestedInference,
          serviceWorkerEnabled

vars == <<projectStore, sessionSecrets, persistentSecrets,
          encryptedCredentialVault, cryptoKeyPresent,
          approvedPayloads, outbound, userRequestedInference,
          serviceWorkerEnabled>>

Init ==
  /\ projectStore = {}
  /\ sessionSecrets = {}
  /\ persistentSecrets = {}
  /\ encryptedCredentialVault = {}
  /\ cryptoKeyPresent = FALSE
  /\ approvedPayloads = {}
  /\ outbound = {}
  /\ userRequestedInference = FALSE
  /\ serviceWorkerEnabled \in BOOLEAN

CreateOrEditProject(data) ==
  /\ data \in ProjectValues
  /\ projectStore' = projectStore \cup {data}
  /\ UNCHANGED <<sessionSecrets, persistentSecrets, encryptedCredentialVault,
                 cryptoKeyPresent, approvedPayloads, outbound,
                 userRequestedInference, serviceWorkerEnabled>>

CreateNonExtractableCryptoKey ==
  /\ cryptoKeyPresent = FALSE
  /\ cryptoKeyPresent' = TRUE
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 encryptedCredentialVault, approvedPayloads, outbound,
                 userRequestedInference, serviceWorkerEnabled>>

StoreEncryptedCredential(ciphertext) ==
  /\ cryptoKeyPresent = TRUE
  /\ ciphertext \in EncryptedCredentialValues
  /\ encryptedCredentialVault' = encryptedCredentialVault \cup {ciphertext}
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 cryptoKeyPresent, approvedPayloads, outbound,
                 userRequestedInference, serviceWorkerEnabled>>

SetSessionSecret(secret) ==
  /\ secret \in SecretValues
  /\ sessionSecrets' = sessionSecrets \cup {secret}
  /\ UNCHANGED <<projectStore, persistentSecrets, encryptedCredentialVault,
                 cryptoKeyPresent, approvedPayloads, outbound,
                 userRequestedInference, serviceWorkerEnabled>>

ApproveInferencePayload(payload) ==
  /\ payload \in PayloadValues
  /\ approvedPayloads' = approvedPayloads \cup {payload}
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 encryptedCredentialVault, cryptoKeyPresent, outbound,
                 userRequestedInference, serviceWorkerEnabled>>

RequestInferenceConsent ==
  /\ userRequestedInference = FALSE
  /\ userRequestedInference' = TRUE
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 encryptedCredentialVault, cryptoKeyPresent, approvedPayloads,
                 outbound, serviceWorkerEnabled>>

RequestInference(origin, payload) ==
  /\ origin \in ApprovedInferenceOrigins
  /\ payload \in approvedPayloads
  /\ userRequestedInference = TRUE
  /\ outbound' = outbound \cup {<<origin, payload, "inference", "consented">>}
  /\ userRequestedInference' = FALSE
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 encryptedCredentialVault, cryptoKeyPresent,
                 approvedPayloads, serviceWorkerEnabled>>

DisableServiceWorker ==
  /\ serviceWorkerEnabled = TRUE
  /\ serviceWorkerEnabled' = FALSE
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 encryptedCredentialVault, cryptoKeyPresent,
                 approvedPayloads, outbound, userRequestedInference>>

Next ==
  \/ \E data \in ProjectValues : CreateOrEditProject(data)
  \/ CreateNonExtractableCryptoKey
  \/ \E ciphertext \in EncryptedCredentialValues : StoreEncryptedCredential(ciphertext)
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
  /\ encryptedCredentialVault \subseteq EncryptedCredentialValues
  /\ cryptoKeyPresent \in BOOLEAN
  /\ approvedPayloads \subseteq PayloadValues
  /\ outbound \subseteq (Origins \X PayloadValues \X {"inference"} \X {"consented"})
  /\ userRequestedInference \in BOOLEAN
  /\ serviceWorkerEnabled \in BOOLEAN

NoPlaintextPersistentCredentials == persistentSecrets = {}
EncryptedVaultRequiresKey ==
  encryptedCredentialVault # {} => cryptoKeyPresent = TRUE
InferenceRequiresConsent ==
  \A item \in outbound : item[4] = "consented"
OnlyApprovedPayloadsEgress ==
  \A item \in outbound : item[2] \in approvedPayloads
InferenceDestinationApproved ==
  \A item \in outbound : item[1] \in ApprovedInferenceOrigins

Spec == Init /\ [][Next]_vars
THEOREM Spec => []TypeOK
THEOREM Spec => []NoPlaintextPersistentCredentials
THEOREM Spec => []EncryptedVaultRequiresKey
THEOREM Spec => []InferenceRequiresConsent
THEOREM Spec => []OnlyApprovedPayloadsEgress
THEOREM Spec => []InferenceDestinationApproved
=============================================================================
