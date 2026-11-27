---------------- MODULE ICAREConversationForests ----------------
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS Messages, Branches, Configurations, Runs, Answers,
          RootMessage, MainBranch, RootConfiguration

ASSUME RootMessage \in Messages
ASSUME MainBranch \in Branches
ASSUME RootConfiguration \in Configurations

VARIABLES messages, messageParent, messageBranch,
          branches, branchParent, branchSource, branchConfiguration,
          configurations, configurationParent,
          runs, runBranch, runPrompt, runConfiguration,
          completedRuns, runAnswer, comparisons

vars ==
  <<messages, messageParent, messageBranch,
    branches, branchParent, branchSource, branchConfiguration,
    configurations, configurationParent,
    runs, runBranch, runPrompt, runConfiguration,
    completedRuns, runAnswer, comparisons>>

Targets(relation, source) ==
  {target : <<source, target>> \in relation}

IsPartialFunction(relation, domain) ==
  \A source \in domain : Cardinality(Targets(relation, source)) <= 1

PromptAvailableInBranch(prompt, branch) ==
  \/ <<prompt, branch>> \in messageBranch
  \/ <<prompt, branch>> \in branchSource

Init ==
  /\ messages = {RootMessage}
  /\ messageParent = {}
  /\ messageBranch = {<<RootMessage, MainBranch>>}
  /\ branches = {MainBranch}
  /\ branchParent = {}
  /\ branchSource = {}
  /\ branchConfiguration = {<<MainBranch, RootConfiguration>>}
  /\ configurations = {RootConfiguration}
  /\ configurationParent = {}
  /\ runs = {}
  /\ runBranch = {}
  /\ runPrompt = {}
  /\ runConfiguration = {}
  /\ completedRuns = {}
  /\ runAnswer = {}
  /\ comparisons = {}

AddMessage(newMessage, branch, parentMessage) ==
  /\ newMessage \in Messages \ messages
  /\ branch \in branches
  /\ parentMessage \in messages
  /\ PromptAvailableInBranch(parentMessage, branch)
  /\ messages' = messages \cup {newMessage}
  /\ messageParent' = messageParent \cup {<<newMessage, parentMessage>>}
  /\ messageBranch' = messageBranch \cup {<<newMessage, branch>>}
  /\ UNCHANGED <<branches, branchParent, branchSource, branchConfiguration,
                 configurations, configurationParent, runs, runBranch,
                 runPrompt, runConfiguration, completedRuns, runAnswer,
                 comparisons>>

ForkConfiguration(newConfiguration, parentConfiguration) ==
  /\ newConfiguration \in Configurations \ configurations
  /\ parentConfiguration \in configurations
  /\ configurations' = configurations \cup {newConfiguration}
  /\ configurationParent' =
       configurationParent \cup {<<newConfiguration, parentConfiguration>>}
  /\ UNCHANGED <<messages, messageParent, messageBranch,
                 branches, branchParent, branchSource, branchConfiguration,
                 runs, runBranch, runPrompt, runConfiguration,
                 completedRuns, runAnswer, comparisons>>

ForkConversation(newBranch, parentBranch, sourceMessage, configuration) ==
  /\ newBranch \in Branches \ branches
  /\ parentBranch \in branches
  /\ sourceMessage \in messages
  /\ PromptAvailableInBranch(sourceMessage, parentBranch)
  /\ configuration \in configurations
  /\ branches' = branches \cup {newBranch}
  /\ branchParent' = branchParent \cup {<<newBranch, parentBranch>>}
  /\ branchSource' = branchSource \cup {<<newBranch, sourceMessage>>}
  /\ branchConfiguration' =
       branchConfiguration \cup {<<newBranch, configuration>>}
  /\ UNCHANGED <<messages, messageParent, messageBranch,
                 configurations, configurationParent,
                 runs, runBranch, runPrompt, runConfiguration,
                 completedRuns, runAnswer, comparisons>>

StartRun(newRun, branch, prompt) ==
  /\ newRun \in Runs \ runs
  /\ branch \in branches
  /\ prompt \in messages
  /\ PromptAvailableInBranch(prompt, branch)
  /\ runs' = runs \cup {newRun}
  /\ runBranch' = runBranch \cup {<<newRun, branch>>}
  /\ runPrompt' = runPrompt \cup {<<newRun, prompt>>}
  /\ runConfiguration' =
       runConfiguration \cup
         {<<newRun, CHOOSE c \in Configurations :
             <<branch, c>> \in branchConfiguration>>}
  /\ UNCHANGED <<messages, messageParent, messageBranch,
                 branches, branchParent, branchSource, branchConfiguration,
                 configurations, configurationParent,
                 completedRuns, runAnswer, comparisons>>

CompleteRun(run, answer) ==
  /\ run \in runs \ completedRuns
  /\ answer \in Answers
  /\ completedRuns' = completedRuns \cup {run}
  /\ runAnswer' = runAnswer \cup {<<run, answer>>}
  /\ UNCHANGED <<messages, messageParent, messageBranch,
                 branches, branchParent, branchSource, branchConfiguration,
                 configurations, configurationParent,
                 runs, runBranch, runPrompt, runConfiguration,
                 comparisons>>

CompareRuns(left, right) ==
  /\ left \in completedRuns
  /\ right \in completedRuns
  /\ left # right
  /\ Targets(runPrompt, left) = Targets(runPrompt, right)
  /\ comparisons' = comparisons \cup {<<left, right>>}
  /\ UNCHANGED <<messages, messageParent, messageBranch,
                 branches, branchParent, branchSource, branchConfiguration,
                 configurations, configurationParent,
                 runs, runBranch, runPrompt, runConfiguration,
                 completedRuns, runAnswer>>

Next ==
  \/ \E m \in Messages, b \in Branches, p \in Messages :
       AddMessage(m, b, p)
  \/ \E c \in Configurations, parent \in Configurations :
       ForkConfiguration(c, parent)
  \/ \E b \in Branches, parent \in Branches,
        source \in Messages, config \in Configurations :
       ForkConversation(b, parent, source, config)
  \/ \E r \in Runs, b \in Branches, prompt \in Messages :
       StartRun(r, b, prompt)
  \/ \E r \in Runs, answer \in Answers : CompleteRun(r, answer)
  \/ \E left \in Runs, right \in Runs : CompareRuns(left, right)
  \/ UNCHANGED vars

TypeOK ==
  /\ messages \subseteq Messages
  /\ messageParent \subseteq Messages \X Messages
  /\ messageBranch \subseteq Messages \X Branches
  /\ branches \subseteq Branches
  /\ branchParent \subseteq Branches \X Branches
  /\ branchSource \subseteq Branches \X Messages
  /\ branchConfiguration \subseteq Branches \X Configurations
  /\ configurations \subseteq Configurations
  /\ configurationParent \subseteq Configurations \X Configurations
  /\ runs \subseteq Runs
  /\ runBranch \subseteq Runs \X Branches
  /\ runPrompt \subseteq Runs \X Messages
  /\ runConfiguration \subseteq Runs \X Configurations
  /\ completedRuns \subseteq runs
  /\ runAnswer \subseteq Runs \X Answers
  /\ comparisons \subseteq Runs \X Runs

MessageHasOneBranch ==
  IsPartialFunction(messageBranch, messages)
  /\ \A message \in messages :
       Cardinality(Targets(messageBranch, message)) = 1

MessageParentIsLocal ==
  \A pair \in messageParent :
    \E branch \in branches :
      /\ <<pair[1], branch>> \in messageBranch
      /\ PromptAvailableInBranch(pair[2], branch)

BranchHasOneParentAndSourceAndConfiguration ==
  /\ IsPartialFunction(branchParent, branches)
  /\ IsPartialFunction(branchSource, branches)
  /\ IsPartialFunction(branchConfiguration, branches)
  /\ \A branch \in branches \ {MainBranch} :
       /\ Cardinality(Targets(branchParent, branch)) = 1
       /\ Cardinality(Targets(branchSource, branch)) = 1
       /\ Cardinality(Targets(branchConfiguration, branch)) = 1

BranchSourceBelongsToParent ==
  \A branch \in branches \ {MainBranch} :
    \E parent \in branches, source \in messages :
      /\ <<branch, parent>> \in branchParent
      /\ <<branch, source>> \in branchSource
      /\ PromptAvailableInBranch(source, parent)

ConfigurationHasOneParent ==
  IsPartialFunction(configurationParent, configurations)

BranchConfigurationExists ==
  \A branch \in branches :
    \E configuration \in configurations :
      <<branch, configuration>> \in branchConfiguration

EveryRunHasOneProvenance ==
  /\ IsPartialFunction(runBranch, runs)
  /\ IsPartialFunction(runPrompt, runs)
  /\ IsPartialFunction(runConfiguration, runs)
  /\ \A run \in runs :
       /\ Cardinality(Targets(runBranch, run)) = 1
       /\ Cardinality(Targets(runPrompt, run)) = 1
       /\ Cardinality(Targets(runConfiguration, run)) = 1

RunUsesBranchConfiguration ==
  \A run \in runs :
    \E branch \in branches, configuration \in configurations :
      /\ <<run, branch>> \in runBranch
      /\ <<run, configuration>> \in runConfiguration
      /\ <<branch, configuration>> \in branchConfiguration

CompletedRunHasOneAnswer ==
  /\ IsPartialFunction(runAnswer, completedRuns)
  /\ \A run \in completedRuns :
       Cardinality(Targets(runAnswer, run)) = 1

ComparisonUsesDistinctCompletedRuns ==
  \A pair \in comparisons :
    /\ pair[1] # pair[2]
    /\ pair[1] \in completedRuns
    /\ pair[2] \in completedRuns
    /\ Targets(runPrompt, pair[1]) = Targets(runPrompt, pair[2])

Spec == Init /\ [][Next]_vars

THEOREM Spec => []TypeOK
THEOREM Spec => []MessageHasOneBranch
THEOREM Spec => []MessageParentIsLocal
THEOREM Spec => []BranchHasOneParentAndSourceAndConfiguration
THEOREM Spec => []BranchSourceBelongsToParent
THEOREM Spec => []ConfigurationHasOneParent
THEOREM Spec => []BranchConfigurationExists
THEOREM Spec => []EveryRunHasOneProvenance
THEOREM Spec => []RunUsesBranchConfiguration
THEOREM Spec => []CompletedRunHasOneAnswer
THEOREM Spec => []ComparisonUsesDistinctCompletedRuns
============================================================
