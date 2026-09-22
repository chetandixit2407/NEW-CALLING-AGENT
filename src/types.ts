export type LanguageMode = 'Auto (Hinglish/Hindi/English)' | 'English' | 'Hindi';

export type CallScenario = 
  | 'screening' 
  | 'reminder' 
  | 'missed_followup' 
  | 'callback_followup';

export type CandidateStatus =
  | 'Screening Pending'
  | 'Screened - Ready for Interview'
  | 'Interview Scheduled'
  | 'Attendance Confirmed'
  | 'Missed Interview - Followup'
  | 'Callback Needed'
  | 'Declined - Do Not Call';

export type InterviewStatus = 
  | 'Not Scheduled' 
  | 'Scheduled' 
  | 'Confirmed' 
  | 'Rescheduled' 
  | 'Missed' 
  | 'Completed' 
  | 'Declined';

export interface ScreeningData {
  currentCompany?: string;
  currentDesignation?: string;
  totalExperienceYears?: number;
  realEstateExperienceYears?: number;
  gurgaonDubaiExperience?: {
    gurgaon: boolean;
    dubai: boolean;
    details?: string;
  };
  currentSalaryLPA?: string;
  expectedSalaryLPA?: string;
  currentLocation?: string;
  noticePeriodDays?: number;
  earliestJoiningDate?: string;
  preferredInterviewSlot?: string;
  interviewVenueConfirmed?: boolean;
}

export interface ChatMessage {
  id: string;
  sender: 'agent' | 'candidate' | 'system';
  text: string;
  timestamp: string;
  language?: 'English' | 'Hindi' | 'Hinglish';
}

export interface CallRecord {
  id: string;
  candidateId: string;
  candidateName: string;
  timestamp: string;
  scenario: CallScenario;
  durationSeconds: number;
  transcript: ChatMessage[];
  summary: string;
  outcome: string;
  extractedFields: Partial<ScreeningData>;
  detectedIntent?: string;
  callbackTime?: string;
  declineReason?: string;
  conversationMemory?: ConversationMemory;
  hrDecisionOutcome?: HrDecisionOutcome;
  afterCallAction?: AfterCallAction;
}

export type RemarkPriority = 'Urgent' | 'High' | 'Medium' | 'Low';

export type RemarkCategory =
  | 'Interview Scheduled'
  | 'Already Joined - Counter Offer Open'
  | 'Already Joined - Future Pipeline'
  | 'Budget Negotiation'
  | 'Notice Period Evaluation'
  | 'Callback Due'
  | 'Missed Interview Reschedule'
  | 'Unanswered Retry'
  | 'Attendance Reconfirmation'
  | 'Declined - Do Not Call';

export interface CandidateRemark {
  id: string;
  text: string;
  priority: RemarkPriority;
  category: RemarkCategory;
  createdAt: string;
  actionDueDate?: string; // e.g. 'Today', 'Tomorrow', 'Overdue', 'In 3 Days', or 'In 30 Days'
  author?: string; // 'Arjun (Virtual AI HR)' | 'HR Operations'
}

export interface Candidate {
  id: string;
  name: string;
  phone: string;
  email: string;
  appliedRole: string;
  status: CandidateStatus;
  screening: ScreeningData;
  interviewSlotId?: string;
  interviewDate?: string;
  interviewTime?: string;
  interviewVenue?: string;
  interviewStatus: InterviewStatus;
  lastCallDate?: string;
  lastEmailSentAt?: string;
  lastWhatsAppSentAt?: string;
  callCount: number;
  unansweredAttempts: number;
  callbackTime?: string;
  declineReason?: string;
  notes?: string;
  // Day-by-day alert & remarks fields
  latestRemark?: CandidateRemark;
  remarksHistory?: CandidateRemark[];
  alertDueDate?: 'Overdue' | 'Today' | 'Tomorrow' | 'Upcoming';
  alertReason?: string;
  conversationMemory?: ConversationMemory;
  hrDecisionOutcome?: HrDecisionOutcome;
  afterCallAction?: AfterCallAction;
  callHistory: CallRecord[];
  scorecard?: {
    gurgaonDubaiScore: 'High' | 'Medium' | 'Low' | 'None';
    experienceFit: 'Senior Fit' | 'Mid Fit' | 'Junior Fit';
    budgetAlignment: 'Within Budget' | 'Stretch' | 'High Expectation';
    joiningTimeline: 'Immediate (<15 days)' | '30 Days' | '60+ Days';
    recommendation: 'Priority Interview' | 'Proceed' | 'Consider Alternative' | 'Not Selected';
  };
}

export interface InterviewSlot {
  id: string;
  date: string;
  time: string;
  displayLabel: string;
  venue: string;
  maxCapacity: number;
  bookedCount: number;
  bookedCandidateId?: string;
  bookedCandidateName?: string;
  isAvailable: boolean;
}

export interface FollowupItem {
  id: string;
  candidateId: string;
  candidateName: string;
  phone: string;
  appliedRole: string;
  type: 'unanswered' | 'missed_interview' | 'callback_requested' | 'attendance_reconfirm';
  priority: 'High' | 'Medium' | 'Low';
  scheduledTimeOrDate: string;
  attemptsMade: number;
  lastNote: string;
}

// Rule 28: Conversation Memory State maintained throughout call
export interface ConversationMemory {
  candidate_name: string;
  target_role: string;
  current_company: string;
  designation: string;
  total_experience: string;
  real_estate_experience: string;
  gurgaon_experience: string;
  dubai_experience: string;
  current_salary: string;
  expected_salary: string;
  salary_not_disclosed: boolean;
  current_location: string;
  notice_period: string;
  earliest_joining_date: string;
  interested: string;
  interview_date: string;
  interview_time: string;
  conversation_status: string;
  missing_information: string[];
  next_action: string;
}

// Rule 35: HR Decision Rules
export type HrDecisionOutcome =
  | 'SCREENING_COMPLETED'
  | 'INTERVIEW_ELIGIBLE'
  | 'INTERVIEW_SCHEDULED'
  | 'FOLLOW_UP_REQUIRED'
  | 'NOT_INTERESTED'
  | 'NO_ANSWER'
  | 'CALL_BACK_REQUESTED'
  | 'INTERVIEW_RESCHEDULE_REQUIRED'
  | 'INTERVIEW_CANCELLED'
  | 'INTERVIEW_ATTENDED'
  | 'INTERVIEW_MISSED'
  | 'REJECTED'
  | 'MANUAL_HR_REVIEW_REQUIRED';

// Rule 37: After-Call Action Record for HR system
export interface AfterCallAction {
  candidate_id: string;
  call_status: string;
  screening_status: HrDecisionOutcome | string;
  target_role: string;
  screening_summary: string;
  candidate_answers: Record<string, any>;
  missing_information: string[];
  interview_status: string;
  interview_date: string;
  interview_time: string;
  follow_up_required: boolean;
  follow_up_date: string;
  hr_remarks: string;
  next_action: string;
}

// Rule 15 & 16: White Collar Realty Job Description
export interface JobDescription {
  id: string;
  title: string;
  department: string;
  location: string;
  minExperienceYears: number;
  maxExperienceYears: number;
  minRealEstateExpYears: number;
  budgetBand: string;
  oteBand: string;
  keyResponsibilities: string[];
  requiredSkills: string[];
  marketFocus: string;
  noticePeriodExpectation: string;
  roleSpecificQuestions: string[];
}

// ==========================================
// QUESTION STATE & ZERO-DUPLICATE QUESTION ENGINE
// ==========================================

export type QuestionTopic =
  | 'identity_permission'
  | 'candidate_introduction'
  | 'target_role'
  | 'total_real_estate_experience'
  | 'current_company'
  | 'current_designation'
  | 'gurgaon_experience'
  | 'dubai_experience'
  | 'developer_projects'
  | 'residential_luxury_ticket_size'
  | 'manager_personal_vs_team_closures'
  | 'sales_performance_metrics'
  | 'scenario_evaluation'
  | 'motivation_for_change'
  | 'current_salary'
  | 'expected_salary'
  | 'notice_period'
  | 'f2f_interview_availability'
  | 'f2f_interview_slot'
  | 'candidate_questions'
  | 'busy_callback_time';

export type QuestionLifecycleStatus =
  | 'QUESTION_GENERATED'
  | 'QUESTION_SPOKEN'
  | 'WAIT_FOR_ANSWER'
  | 'ANSWER_RECEIVED'
  | 'ANSWER_ANALYZED'
  | 'QUESTION_CLOSED';

export interface AskedQuestionRecord {
  questionId: string;
  exactQuestion: string;
  normalizedQuestion: string;
  topic: QuestionTopic | string;
  timestamp: string;
  candidateAnswer?: string;
  answerStatus: 'ANSWERED' | 'PARTIAL' | 'CLARIFICATION_NEEDED' | 'SKIPPED' | 'WAITING';
  whetherFollowUpWasNeeded: boolean;
}

export interface ContradictionRecord {
  topic: string;
  previousValue: string;
  newValue: string;
  resolvedValue?: string;
  status: 'PENDING_CLARIFICATION' | 'RESOLVED';
  timestamp: string;
}

export interface ScenarioRecord {
  scenarioId: string;
  scenarioType: string;
  roleTarget: string;
  difficulty: 'EARLY_CAREER' | 'INTERMEDIATE' | 'SENIOR' | 'LEADERSHIP' | 'SPECIALIST';
  scenarioQuestion: string;
  candidateAnswer?: string;
  followupQuestion?: string;
  candidateReasoning?: string;
  competencyTested: string;
  status: 'PROPOSED' | 'EVALUATED' | 'FOLLOWUP_COMPLETED';
}

export interface QuestionStateEngine {
  activeQuestionId: string | null;
  activeQuestion: string | null;
  activeTopic: QuestionTopic | string | null;
  questionStatus: QuestionLifecycleStatus;
  lastSpokenQuestion: string | null;
  askedQuestions: AskedQuestionRecord[];
  answeredTopics: string[];
  openTopics: string[];
  candidateFacts: Record<string, any>;
  pendingClarifications: string[];
  contradictions: ContradictionRecord[];
}

export interface AutonomousHrSessionState {
  conversationState: {
    stage: 'AGENT_INTRO' | 'ID_CONFIRMED' | 'CANDIDATE_INTRO' | 'DYNAMIC_SCREENING' | 'SCENARIO_EVAL' | 'CROSS_EXAM' | 'COMP_NOTICE' | 'INTERVIEW_SCHEDULING' | 'SUMMARY_CLOSE';
    activeQuestion: string;
    activeTopic: string;
    questionStatus: QuestionLifecycleStatus | string;
    candidateSpeaking: boolean;
  };
  candidateProfile: {
    experience: {
      totalYears?: number;
      realEstateYears?: number;
      gurgaonYears?: number;
      dubaiYears?: number;
    };
    roles: string[];
    companies: string[];
    markets: string[];
    segments: string[];
    projects: string[];
    ticketSizes: string[];
    performance: {
      monthlyTarget?: string;
      achievementRate?: string;
      highestClosure?: string;
      runRate?: string;
    };
    teamManagement: {
      teamSize?: number;
      directReports?: number;
      personalVsTeamSplit?: string;
      coachingStrategy?: string;
    };
    compensation: {
      currentSalary?: string;
      expectedSalary?: string;
      noticePeriodDays?: number;
      earliestJoining?: string;
    };
    availability: {
      f2fSlot?: string;
      venueConfirmed?: boolean;
    };
  };
  questionMemory: {
    askedQuestions: AskedQuestionRecord[];
    answeredTopics: string[];
    openTopics: string[];
    pendingClarifications: string[];
  };
  scenarioMemory: {
    scenariosUsed: string[];
    scenarioResults: ScenarioRecord[];
  };
}

// ==========================================
// SELF-LEARNING AI HR BRAIN & MEMORY ARCHITECTURE
// ==========================================

export type FactSource = 
  | 'candidate_spoken' 
  | 'candidate_message' 
  | 'application_form' 
  | 'recruiter' 
  | 'system'
  | 'human_hr_override';

export interface MemoryFact<T = any> {
  field: string;
  value: T;
  source: FactSource;
  conversationId?: string;
  timestamp: string;
  confidence: number;
  verified: boolean;
  lastVerifiedAt?: string;
  notes?: string;
  history?: Array<{
    value: T;
    source: FactSource;
    timestamp: string;
    conversationId?: string;
    reason?: string;
  }>;
}

export interface CandidateMemoryContradiction {
  id: string;
  field: string;
  topic: string;
  previousValue: string;
  previousSource: FactSource;
  previousTimestamp: string;
  newValue: string;
  newSource: FactSource;
  newTimestamp: string;
  conversationId: string;
  status: 'PENDING_CLARIFICATION' | 'RESOLVED' | 'DISMISSED';
  resolvedValue?: string;
  resolvedAt?: string;
  resolutionNote?: string;
}

export interface CandidateCorrectionRecord {
  id: string;
  type: 'AI_CORRECTION' | 'CANDIDATE_CORRECTION' | 'RECRUITER_CORRECTION';
  field: string;
  previousValue: string;
  correctValue: string;
  source: string;
  conversationId: string;
  timestamp: string;
  context?: string;
}

export interface CandidateSpecificPreference {
  preferredLanguage?: 'English' | 'Hindi' | 'Hinglish';
  communicationStyle?: 'concise' | 'detailed' | 'conversational';
  bestTimeToCall?: string;
  preferredCallbackWindow?: string;
  channelPreference?: 'Call' | 'WhatsApp' | 'Email';
  objectionNotes?: string[];
  insights?: string[];
}

export interface CandidateLongTermMemory {
  candidateId: string;
  candidateName: string;
  identity: {
    name?: MemoryFact<string>;
    phone?: MemoryFact<string>;
    email?: MemoryFact<string>;
    location?: MemoryFact<string>;
  };
  experience: {
    totalYears?: MemoryFact<number>;
    realEstateYears?: MemoryFact<number>;
    gurgaonYears?: MemoryFact<number>;
    dubaiYears?: MemoryFact<number>;
  };
  companies: MemoryFact<string[]>;
  designations: MemoryFact<string[]>;
  markets: MemoryFact<string[]>;
  projects: MemoryFact<string[]>;
  developers: MemoryFact<string[]>;
  segments: MemoryFact<string[]>;
  ticketSizes: MemoryFact<string[]>;
  luxuryExperience: {
    hasLuxury?: MemoryFact<boolean>;
    ticketSizesHandled?: MemoryFact<string[]>;
    hniExposure?: MemoryFact<string>;
    developersHandled?: MemoryFact<string[]>;
    primaryVsSecondary?: MemoryFact<string>;
    closingEvidence?: MemoryFact<string>;
  };
  salesPerformance: {
    highestPersonalClosure?: MemoryFact<string>;
    monthlyRunRate?: MemoryFact<string>;
    targetAchievement?: MemoryFact<string>;
    dealStructureExpertise?: MemoryFact<string>;
  };
  teamManagement: {
    teamSize?: MemoryFact<number>;
    personalVsTeamSplit?: MemoryFact<string>;
    reportingSpan?: MemoryFact<string>;
  };
  compensation: {
    currentSalary?: MemoryFact<string>;
    expectedSalary?: MemoryFact<string>;
    isDisclosed?: MemoryFact<boolean>;
  };
  noticePeriod: {
    days?: MemoryFact<number>;
    earliestJoining?: MemoryFact<string>;
    negotiable?: MemoryFact<boolean>;
  };
  interviewAvailability: {
    agreedSlot?: MemoryFact<string>;
    venueAcknowledged?: MemoryFact<boolean>;
    slotId?: MemoryFact<string>;
  };
  communicationPreferences: CandidateSpecificPreference;
  candidateQuestions: Array<{
    question: string;
    timestamp: string;
    conversationId: string;
    answered: boolean;
    topicCategory: string;
  }>;
  concerns: Array<{
    concern: string;
    timestamp: string;
    conversationId: string;
    severity: 'Low' | 'Medium' | 'High';
    addressed: boolean;
  }>;
  interests: string[];
  unresolvedQuestions: string[];
  contradictions: CandidateMemoryContradiction[];
  corrections: CandidateCorrectionRecord[];
  importantStatements: Array<{
    statement: string;
    topic: string;
    timestamp: string;
    conversationId: string;
  }>;
  previousOutcomes: Array<{
    conversationId: string;
    outcome: string;
    timestamp: string;
    summary: string;
  }>;
  candidateSpecificLearnings: string[];
  nextAction: {
    action: string;
    dueDate?: string;
    owner?: string;
    suggestedTopic?: string;
    unresolvedTopic?: string;
  };
  lastUpdated: string;
}

export interface NextCallBrief {
  candidateId: string;
  candidateName: string;
  appliedRole: string;
  summaryOfPreviousInteractions: string;
  lastInteractionTimestamp: string;
  alreadyDiscussedTopics: string[];
  verifiedInformationSummary: string[];
  unresolvedTopics: string[];
  forbiddenRepeatQuestions: string[];
  candidateConcerns: string[];
  candidateQuestionsToAddress: string[];
  communicationPreferences: {
    language: string;
    responseStyle: string;
    preferredTimeWindow?: string;
  };
  previousPromises: string[];
  callbackRequestDetails?: {
    requestedTime?: string;
    reason?: string;
  };
  interviewState: string;
  recommendedStartingTopic: string;
  suggestedOpeningStatement: string;
  targetScenariosToEvaluate?: string[];
  contradictionsRequiringClarification: Array<{
    field: string;
    previousValue: string;
    newValue: string;
    clarificationPrompt: string;
  }>;
}

export interface LearningProposal {
  id: string;
  type: 'LEARNING_PROPOSAL';
  pattern: string;
  evidenceCount: number;
  evidenceExamples: string[];
  affectedRoles: string[];
  category: 'COMPENSATION_OBJECTION' | 'ROLE_CLARITY' | 'PROJECT_INQUIRY' | 'QUESTION_OPTIMIZATION' | 'SCENARIO_REFINEMENT' | 'SCHEDULE_OPTIMIZATION';
  suggestedChange: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  requiresHumanApproval: boolean;
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'APPLIED';
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
}

export interface HumanFeedbackRecord {
  id: string;
  candidateId: string;
  candidateName: string;
  conversationId?: string;
  timestamp: string;
  reviewerName: string;
  changeType: 'STATUS_CHANGE' | 'REMARK_OVERRIDE' | 'QUALIFICATION_DECISION' | 'REJECTION_REASON' | 'PRIORITY_UPDATE' | 'ROLE_REALIGNMENT' | 'NEXT_ACTION_MODIFIED';
  aiRecommendation: {
    status?: string;
    qualification?: string;
    remark?: string;
    nextAction?: string;
  };
  humanDecision: {
    status?: string;
    qualification?: string;
    remark?: string;
    nextAction?: string;
    reason: string;
  };
  learningGenerated?: string;
}

export interface QuestionEffectivenessStat {
  questionId: string;
  questionText: string;
  topic: string;
  roleTarget: string;
  experienceBracket: string;
  timesAsked: number;
  successfulAnswerRate: number; // 0 to 1
  followUpNeededCount: number;
  averageAnswerQuality: 'HIGH' | 'MEDIUM' | 'LOW';
  actionableInsightsYielded: number;
  effectivenessRating: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ScenarioEffectivenessStat {
  scenarioId: string;
  scenarioTitle: string;
  roleTarget: string;
  seniorityTier: string;
  timesPresented: number;
  averageInformationValue: 'HIGH' | 'MEDIUM' | 'LOW';
  differentiatesStrongCandidatesRate: number; // 0 to 1
  recommendedFor: string[];
}

export interface HrBrainOverviewStats {
  totalLearnedFacts: number;
  verifiedFactsCount: number;
  activeContradictions: number;
  resolvedContradictions: number;
  correctionsRecorded: number;
  learningProposalsPending: number;
  learningProposalsApproved: number;
  humanFeedbackEntries: number;
  totalCallsProcessed: number;
  zeroRepetitionSuccessRate: number;
  systemMemoryLayers: {
    layer1_CurrentConversation: string;
    layer2_CandidateLongTerm: string;
    layer3_RoleJdMemory: string;
    layer4_CompanyKnowledge: string;
    layer5_RecruitmentLearning: string;
    layer6_HumanFeedback: string;
  };
}


