Feature: Project access and membership governance

  Scenario: A shared project link does not grant access
    Given A owns a private project
    When B opens the project link and authenticates with Discord
    Then B is not a project member
    And B cannot read or modify project content
    And B can request to join

  Scenario: Only an owner can accept a membership request
    Given A owns a project
    And B is a member of the project
    And C has a pending membership request
    When B attempts to accept C's request
    Then the operation is refused
    And C remains a non-member
    When A accepts C's request
    Then C becomes a member
    And the grant is recorded as a CRDT project membership operation

  Scenario: Repeated requests are idempotent
    Given C is not a member of the project
    When C submits the same membership request twice while it is pending
    Then only one pending request exists for C and this project

  Scenario: Rejection never grants access
    Given C has a pending membership request
    When an owner rejects the request
    Then C remains a non-member
    And no membership grant is recorded

  Scenario: A revoked offline contributor is not silently republished
    Given B is a member and creates a local contribution while offline
    And an owner revokes B before B reconnects
    When B reconnects and synchronization revalidates the current ACL
    Then B's offline contribution remains preserved locally
    And it is not published to the shared project
    And its state is reported as rejected authorization or quarantined

  Scenario: The same participant uses distinct replicas
    Given B uses ICARE on a phone and a laptop
    Then the phone and laptop have distinct replica identities
    And both contributions retain B's authenticated participant identity
