---------------- MODULE ICAREConversationForests ----------------
EXTENDS Naturals, FiniteSets, Sequences, TLC

CONSTANTS Messages, Branches, Configurations, Runs, Answers,
          ScoreDimensions, ScoreValues,
          RootMessage, MainBranch, RootConfiguration

ASSUME RootMessage \in Messages
ASSUME MainBranch \in Branches
ASSUME RootConfiguration \in Configurations
ASSUME ScoreDimensions # {}
ASSUME ScoreValues \subseteq Nat

VARIABLES messages, messageParent, messageBranch,
          branches, branchParent, branchSource, branchConfiguration,
          branchTimeline, branchInheritedPrefix,
          configurations, configurationParent,
          runs, runBranch, runPrompt, runConfiguration,
          completedRuns, runAnswer, comparisons,
          scoreEvents

vars ==
  <<messages, messageParent, messageBranch,
    branches, branchParent, branchSource, branchConfiguration,
    branchTimeline, branchInheritedPrefix,
    configurations, configurationParent,
    runs, runBranch, runPrompt, runConfiguration,
    completedRuns, runAnswer, comparisons,
    scoreEvents>>

AllIds == Messages \cup Branches \cup Configurations \cup Runs \cup Answers

Targets(relation, origin) ==
  {target \in AllIds : <<origin, target>> \in relation}

IsPartialFunction(relation, domain) ==
  \A item \in domain : Cardinality(Targets(relation, item)) <= 1

PositionOf(history, message) ==
  CHOOSE i \in 1..Len(history) : history[i] = message

PromptAvailableInBranch(prompt, branch) ==
  \E i \in 1..Len(branchTimeline[branch]) :
    branchTimeline[branch][i] = prompt

HasScore(message, dimension) ==
  \E value \in ScoreValues :
    <<message, dimension, value>> \in scoreEvents

ScoreValue(message, dimension) ==
  IF HasScore(message, dimension)
  THEN CHOOSE value \in ScoreValues :
         <<message, dimension, value>> \in scoreEvents
  ELSE 0

RECURSIVE SumMessageScores(_, _)
SumMessageScores(history, dimension) ==
  IF Len(history) = 0
  THEN 0
  ELSE ScoreValue(Head(history), dimension)
       + SumMessageScores(Tail(history), dimension)

RadarAt(branch, position) ==
  [dimension \in ScoreDimensions |->
    SumMessageScores(SubSeq(branchTimeline[branch], 1, position), dimension)]

RunRadar(run) ==
  LET branch == CHOOSE b \in branches : <<run, b>> \in runBranch
      prompt == CHOOSE m \in messages : <<run, m>> \in runPrompt
  IN RadarAt(branch, PositionOf(branchTimeline[branch], prompt))

Init ==
  /\ messages = {RootMessage}
  /\ messageParent = {}
  /\ messageBranch = {<<RootMessage, MainBranch>>}
  /\ branches = {MainBranch}
  /\ branchParent = {}
  /\ branchSource = {}
  /\ branchConfiguration = {<<MainBranch, RootConfiguration>>}
  /\ branchTimeline =
       [branch \in Branches |->
         IF branch = MainBranch THEN <<RootMessage>> ELSE <<>>]
  /\ branchInheritedPrefix = [branch \in Branches |-> <<>>]
  /\ configurations = {RootConfiguration}
  /\ configurationParent = {}
  /\ runs = {}
  /\ runBranch = {}
  /\ runPrompt = {}
  /\ runConfiguration = {}
  /\ completedRuns = {}
  /\ runAnswer = {}
  /\ comparisons = {}
  /\ scoreEvents = {}

AddMessage(newMessage, branch, parentMessage) ==
  /\ newMessage \in Messages \ messages
  /\ branch \in branches
  /\ parentMessage \in messages
  /\ PromptAvailableInBranch(parentMessage, branch)
  /\ messages' = messages \cup {newMessage}
  /\ messageParent' = messageParent \cup {<<newMessage, parentMessage>>}
  /\ messageBranch' = messageBranch \cup {<<newMessage, branch>>}
  /\ branchTimeline' =
       [branchTimeline EXCEPT ![branch] = Append(@, newMessage)]
  /\ UNCHANGED <<branches, branchParent, branchSource, branchConfiguration,
                 configurations, configurationParent, runs, runBranch,
                 runPrompt, runConfiguration, completedRuns, runAnswer,
                 comparisons, scoreEvents>>

ForkConfiguration(newConfiguration, parentConfiguration) ==
  /\ newConfiguration \in Configurations \ configurations
  /\ parentConfiguration \in configurations
  /\ configurations' = configurations \cup {newConfiguration}
  /\ configurationParent' =
       configurationParent \cup {<<newConfiguration, parentConfiguration>>}
  /\ UNCHANGED <<messages, messageParent, messageBranch,
                 branches, branchParent, branchSource, branchConfiguration,
                 branchTimeline, runs, runBranch, runPrompt, runConfiguration,
                 completedRuns, runAnswer, comparisons, scoreEvents>>

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
  /\ branchTimeline' =
       [branchTimeline EXCEPT
          ![newBranch] =
            SubSeq(branchTimeline[parentBranch], 1,
                   PositionOf(branchTimeline[parentBranch], sourceMessage))]
  /\ branchInheritedPrefix' =
       [branchInheritedPrefix EXCEPT
          ![newBranch] =
            SubSeq(branchTimeline[parentBranch], 1,
                   PositionOf(branchTimeline[parentBranch], sourceMessage))]
  /\ UNCHANGED <<messages, messageParent, messageBranch,
                 configurations, configurationParent,
                 runs, runBranch, runPrompt, runConfiguration,
                 completedRuns, runAnswer, comparisons, scoreEvents>>

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
                 branchTimeline, branchInheritedPrefix, configurations, configurationParent,
                 completedRuns, runAnswer, comparisons, scoreEvents>>

CompleteRun(run, answer) ==
  /\ run \in runs \ completedRuns
  /\ answer \in Answers
  /\ completedRuns' = completedRuns \cup {run}
  /\ runAnswer' = runAnswer \cup {<<run, answer>>}
  /\ UNCHANGED <<messages, messageParent, messageBranch,
                 branches, branchParent, branchSource, branchConfiguration,
                 branchTimeline, configurations, configurationParent,
                 runs, runBranch, runPrompt, runConfiguration,
                 comparisons, scoreEvents>>

RecordScore(message, dimension, value) ==
  /\ message \in messages
  /\ dimension \in ScoreDimensions
  /\ value \in ScoreValues
  /\ ~HasScore(message, dimension)
  /\ scoreEvents' = scoreEvents \cup {<<message, dimension, value>>}
  /\ UNCHANGED <<messages, messageParent, messageBranch,
                 branches, branchParent, branchSource, branchConfiguration,
                 branchTimeline, configurations, configurationParent,
                 runs, runBranch, runPrompt, runConfiguration,
                 completedRuns, runAnswer, comparisons>>

CompareRuns(left, right) ==
  /\ left \in completedRuns
  /\ right \in completedRuns
  /\ left # right
  /\ Targets(runPrompt, left) = Targets(runPrompt, right)
  /\ comparisons' = comparisons \cup {<<left, right>>}
  /\ UNCHANGED <<messages, messageParent, messageBranch,
                 branches, branchParent, branchSource, branchConfiguration,
                 branchTimeline, configurations, configurationParent,
                 runs, runBranch, runPrompt, runConfiguration,
                 completedRuns, runAnswer, scoreEvents>>

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
  \/ \E m \in Messages, d \in ScoreDimensions, v \in ScoreValues :
       RecordScore(m, d, v)
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
  /\ branchTimeline \in [Branches -> Seq(Messages)]
  /\ branchInheritedPrefix \in [Branches -> Seq(Messages)]
  /\ configurations \subseteq Configurations
  /\ configurationParent \subseteq Configurations \X Configurations
  /\ runs \subseteq Runs
  /\ runBranch \subseteq Runs \X Branches
  /\ runPrompt \subseteq Runs \X Messages
  /\ runConfiguration \subseteq Runs \X Configurations
  /\ completedRuns \subseteq runs
  /\ runAnswer \subseteq Runs \X Answers
  /\ comparisons \subseteq Runs \X Runs
  /\ scoreEvents \subseteq Messages \X ScoreDimensions \X ScoreValues

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

BranchConfigurationExists ==
  \A branch \in branches :
    \E configuration \in configurations :
      <<branch, configuration>> \in branchConfiguration

BranchTimelineIsValid ==
  \A branch \in branches :
    /\ Len(branchTimeline[branch]) > 0
    /\ SeqToSet(branchTimeline[branch]) \subseteq messages
    /\ Cardinality(SeqToSet(branchTimeline[branch])) =
         Len(branchTimeline[branch])

BranchTimelinePreservesInheritedPrefix ==
  \A branch \in branches :
    SubSeq(branchTimeline[branch], 1,
           Len(branchInheritedPrefix[branch])) =
      branchInheritedPrefix[branch]

InheritedPrefixEndsAtForkSource ==
  \A branch \in branches \ {MainBranch} :
    \E source \in messages :
      /\ <<branch, source>> \in branchSource
      /\ Len(branchInheritedPrefix[branch]) > 0
      /\ branchInheritedPrefix[branch]
           [Len(branchInheritedPrefix[branch])] = source

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

RunPromptBelongsToTimeline ==
  \A run \in runs :
    \E branch \in branches, prompt \in messages :
      /\ <<run, branch>> \in runBranch
      /\ <<run, prompt>> \in runPrompt
      /\ PromptAvailableInBranch(prompt, branch)

CompletedRunHasOneAnswer ==
  /\ IsPartialFunction(runAnswer, completedRuns)
  /\ \A run \in completedRuns :
       Cardinality(Targets(runAnswer, run)) = 1

ScoreIsUniquePerMessageAndDimension ==
  \A message \in messages, dimension \in ScoreDimensions :
    Cardinality({value \in ScoreValues :
      <<message, dimension, value>> \in scoreEvents}) <= 1

ComparisonUsesDistinctCompletedRuns ==
  \A pair \in comparisons :
    /\ pair[1] # pair[2]
    /\ pair[1] \in completedRuns
    /\ pair[2] \in completedRuns
    /\ Targets(runPrompt, pair[1]) = Targets(runPrompt, pair[2])

ComparisonRadarsAreBranchScoped ==
  \A pair \in comparisons :
    /\ pair[1] # pair[2]
    /\ RunRadar(pair[1]) \in [ScoreDimensions -> Nat]
    /\ RunRadar(pair[2]) \in [ScoreDimensions -> Nat]

Spec == Init /\ [][Next]_vars

THEOREM Spec => []TypeOK
THEOREM Spec => []MessageHasOneBranch
THEOREM Spec => []MessageParentIsLocal
THEOREM Spec => []BranchHasOneParentAndSourceAndConfiguration
THEOREM Spec => []BranchSourceBelongsToParent
THEOREM Spec => []BranchConfigurationExists
THEOREM Spec => []BranchTimelineIsValid
THEOREM Spec => []BranchTimelinePreservesInheritedPrefix
THEOREM Spec => []InheritedPrefixEndsAtForkSource
THEOREM Spec => []EveryRunHasOneProvenance
THEOREM Spec => []RunUsesBranchConfiguration
THEOREM Spec => []RunPromptBelongsToTimeline
THEOREM Spec => []CompletedRunHasOneAnswer
THEOREM Spec => []ScoreIsUniquePerMessageAndDimension
THEOREM Spec => []ComparisonUsesDistinctCompletedRuns
THEOREM Spec => []ComparisonRadarsAreBranchScoped
============================================================
