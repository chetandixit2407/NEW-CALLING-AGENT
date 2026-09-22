import {
  QuestionTopic,
  QuestionLifecycleStatus,
  AskedQuestionRecord,
  ContradictionRecord,
  QuestionStateEngine,
} from '../types';

/**
 * Canonical Topic Definitions & Semantic Lexicon
 * Groups semantically equivalent question patterns under canonical topics.
 */
export const TOPIC_SEMANTIC_PATTERNS: Record<
  QuestionTopic,
  {
    label: string;
    description: string;
    samplePhrases: string[];
    priorityOrder: number;
    extractFacts: (text: string, candidateFacts: Record<string, any>) => Partial<Record<string, any>>;
  }
> = {
  identity_permission: {
    label: 'Identity & Availability',
    description: 'Verify candidate identity and 2-minute availability check',
    samplePhrases: [
      'am i speaking with',
      'do you have a couple of minutes',
      'is this a good time to speak',
      'regarding your application',
      'calling from white collar realty',
    ],
    priorityOrder: 1,
    extractFacts: (text) => {
      const lower = text.toLowerCase();
      if (lower.includes('yes') || lower.includes('speaking') || lower.includes('haan') || lower.includes('sure') || lower.includes('bol raha')) {
        return { identityConfirmed: true, permissionGranted: true };
      }
      return {};
    },
  },
  target_role: {
    label: 'Target Role Confirmation',
    description: 'Confirm role applied for (e.g. Sales Executive, Sales Manager, Pre-Sales)',
    samplePhrases: [
      'considered for the',
      'position, correct',
      'role applied for',
      'for the position of',
    ],
    priorityOrder: 2,
    extractFacts: (text) => {
      const lower = text.toLowerCase();
      if (lower.includes('yes') || lower.includes('correct') || lower.includes('right') || lower.includes('haan')) {
        return { roleConfirmed: true };
      }
      return {};
    },
  },
  current_company: {
    label: 'Current Organization',
    description: 'Current real estate employer / brokerage / builder firm',
    samplePhrases: [
      'which company are you currently with',
      'where are you currently working',
      'who are you working with',
      'which real estate company',
      'where are you working right now',
      'current organization',
    ],
    priorityOrder: 3,
    extractFacts: (text) => {
      const lower = text.toLowerCase();
      const companies = ['dlf', 'm3m', 'square yards', 'anarock', 'godrej', 'emaar', 'sobha', 'proptiger', 'signature global', 'adani', 'trump tower', 'central park', 'abc realty', 'propshop', '360 realtors', 'investors clinic'];
      for (const comp of companies) {
        if (lower.includes(comp)) {
          return { currentCompany: comp.toUpperCase() };
        }
      }
      if (text.length > 2 && text.length < 50 && !text.includes('?')) {
        return { currentCompany: text.trim() };
      }
      return {};
    },
  },
  current_designation: {
    label: 'Current Designation',
    description: 'Current professional title / role level',
    samplePhrases: [
      'what is your current designation',
      'what designation do you hold',
      'what is your role there',
      'what position do you hold',
    ],
    priorityOrder: 4,
    extractFacts: (text) => {
      const lower = text.toLowerCase();
      const desigs = ['senior consultant', 'property consultant', 'sales manager', 'team lead', 'associate', 'director', 'manager', 'consultant', 'sales executive', 'pre-sales executive', 'relationship manager', 'closing manager'];
      for (const d of desigs) {
        if (lower.includes(d)) {
          return { currentDesignation: d.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') };
        }
      }
      return {};
    },
  },
  total_real_estate_experience: {
    label: 'Real Estate Sales Experience',
    description: 'Total years of active property sales advisory experience',
    samplePhrases: [
      'how many years of experience',
      'how long have you been working in real estate',
      'how much experience do you have in real estate sales',
      'tell me about your total real-estate experience',
      'total sales experience',
      'years in property sales',
    ],
    priorityOrder: 5,
    extractFacts: (text) => {
      const lower = text.toLowerCase();
      const expMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/);
      if (expMatch) {
        return { totalExperienceYears: parseFloat(expMatch[1]), realEstateExperienceYears: parseFloat(expMatch[1]) };
      }
      const numMatch = lower.match(/\b(\d+(?:\.\d+)?)\b/);
      if (numMatch && (lower.includes('experience') || lower.includes('year') || lower.length < 15)) {
        return { totalExperienceYears: parseFloat(numMatch[1]), realEstateExperienceYears: parseFloat(numMatch[1]) };
      }
      return {};
    },
  },
  gurgaon_experience: {
    label: 'Gurgaon Micro-Market Exposure',
    description: 'Familiarity with Golf Course Rd, Ext Rd, SPR, Dwarka Exp, Sohna Rd',
    samplePhrases: [
      'how familiar are you with the gurgaon market',
      'gurgaon real estate experience',
      'which micro-markets in gurgaon',
      'closed any deals in golf course road or spr',
      'experience in gurugram',
    ],
    priorityOrder: 6,
    extractFacts: (text) => {
      const lower = text.toLowerCase();
      if (lower.includes('gurgaon') || lower.includes('gurugram') || lower.includes('golf course') || lower.includes('spr') || lower.includes('dwarka') || lower.includes('sohna')) {
        return { gurgaonExperience: true, gurgaonDetails: text.trim() };
      }
      return {};
    },
  },
  dubai_experience: {
    label: 'Dubai Market Exposure',
    description: 'Off-plan and luxury freehold experience in Dubai prime communities',
    samplePhrases: [
      'worked in dubai',
      'dubai real estate experience',
      'dubai off-plan',
      'palm jumeirah or dubai hills',
    ],
    priorityOrder: 7,
    extractFacts: (text) => {
      const lower = text.toLowerCase();
      if (lower.includes('dubai') || lower.includes('off-plan') || lower.includes('palm') || lower.includes('downtown')) {
        return { dubaiExperience: true, dubaiDetails: text.trim() };
      }
      return {};
    },
  },
  developer_projects: {
    label: 'Developer Portfolios Closed',
    description: 'Specific builder projects closed (DLF, M3M, Godrej, Emaar, Sobha, SmartWorld)',
    samplePhrases: [
      'which specific developers and projects',
      'which builders have you closed',
      'dlf m3m godrej emaar',
      'projects have you actively closed',
    ],
    priorityOrder: 8,
    extractFacts: (text) => {
      const lower = text.toLowerCase();
      const devs = ['dlf', 'm3m', 'godrej', 'emaar', 'sobha', 'smartworld', 'elan', 'central park'];
      const matched = devs.filter((d) => lower.includes(d));
      if (matched.length > 0) {
        return { developerProjects: matched.map((d) => d.toUpperCase()).join(', ') };
      }
      return {};
    },
  },
  residential_luxury_ticket_size: {
    label: 'Luxury Ticket Size & Conversion',
    description: 'Average & highest deal ticket sizes (₹3 Cr – ₹15 Cr+)',
    samplePhrases: [
      'what has been your average ticket size',
      'highest single-ticket luxury residential',
      'ticket sizes have you closed',
      'what category of properties have you primarily closed',
    ],
    priorityOrder: 9,
    extractFacts: (text) => {
      const lower = text.toLowerCase();
      const crMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:cr|crore|crores)/);
      if (crMatch) {
        return { luxuryTicketSize: `₹${crMatch[1]} Cr` };
      }
      return {};
    },
  },
  manager_personal_vs_team_closures: {
    label: 'Personal vs Squad Closures (Manager Role)',
    description: 'Ratio of direct personal closures vs negotiation assistance and squad management',
    samplePhrases: [
      'direct personal contribution versus deals',
      'how large was the sales team',
      'walk me through one of your last five major high-ticket closures',
      'out of your total monthly closures',
    ],
    priorityOrder: 10,
    extractFacts: (text) => {
      if (text.length > 10) {
        return { managerialClosureDetails: text.trim() };
      }
      return {};
    },
  },
  sales_performance_metrics: {
    label: 'Sales Run-Rate & Site Visit Metrics',
    description: 'Monthly gross bookings, qualified calls to site visit ratios',
    samplePhrases: [
      'monthly qualified lead-to-site-visit',
      'how many qualified site visits',
      'how many calls or leads were you typically handling',
      'what has been your monthly run-rate',
    ],
    priorityOrder: 11,
    extractFacts: (text) => {
      if (text.length > 5) {
        return { performanceMetrics: text.trim() };
      }
      return {};
    },
  },
  scenario_evaluation: {
    label: 'Scenario Objection / Negotiation Test',
    description: 'Handling client objections, price comparisons without discounting',
    samplePhrases: [
      'suppose an hni buyer has completed a site visit',
      'suppose one of your top consultants',
      'how would you coach them to demonstrate value',
      'stuck on price between two competing luxury projects',
    ],
    priorityOrder: 12,
    extractFacts: (text) => {
      if (text.length > 15) {
        return { scenarioResponse: text.trim() };
      }
      return {};
    },
  },
  motivation_for_change: {
    label: 'Reason for Job Change',
    description: 'Career motivation and reasons for considering White Collar Realty',
    samplePhrases: [
      'what is prompting you to look for a change',
      'why are you looking to leave',
      'reason for change',
    ],
    priorityOrder: 13,
    extractFacts: (text) => {
      if (text.length > 5) {
        return { reasonForChange: text.trim() };
      }
      return {};
    },
  },
  current_salary: {
    label: 'Current Fixed CTC',
    description: 'Current fixed annual compensation / in-hand monthly salary',
    samplePhrases: [
      'what is your current fixed salary',
      'could you share your current compensation',
      'what are you drawing currently',
      'current fixed ctc',
      'current salary',
    ],
    priorityOrder: 14,
    extractFacts: (text) => {
      const lower = text.toLowerCase();
      if (lower.includes('confidential') || lower.includes('nda') || lower.includes('prefer not') || lower.includes('cannot disclose')) {
        return { currentSalaryLPA: 'Confidential', salaryDeclined: true };
      }
      const salMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:lpa|lakh|lakhs|lac|lacs)/);
      if (salMatch) {
        return { currentSalaryLPA: `${salMatch[1]} LPA` };
      }
      return {};
    },
  },
  expected_salary: {
    label: 'Expected CTC',
    description: 'Expected fixed compensation / CTC expectation',
    samplePhrases: [
      'what are you expecting for your next move',
      'expected compensation',
      'expected ctc',
      'expected salary',
    ],
    priorityOrder: 15,
    extractFacts: (text) => {
      const lower = text.toLowerCase();
      const expMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:lpa|lakh|lakhs|lac|lacs)/);
      if (expMatch) {
        return { expectedSalaryLPA: `${expMatch[1]} LPA` };
      }
      return {};
    },
  },
  notice_period: {
    label: 'Notice Period & Earliest Joining',
    description: 'Current notice period in days and joining date feasibility',
    samplePhrases: [
      'what is your current notice period',
      'how soon can you join',
      'earliest joining date',
      'serving notice',
      'notice period',
    ],
    priorityOrder: 16,
    extractFacts: (text) => {
      const lower = text.toLowerCase();
      if (lower.includes('immediate') || lower.includes('turant') || lower.includes('serving')) {
        return { noticePeriodDays: 0, earliestJoining: 'Immediate' };
      }
      const noticeMatch = lower.match(/(\d+)\s*(?:days?|din)/);
      if (noticeMatch) {
        return { noticePeriodDays: parseInt(noticeMatch[1], 10) };
      }
      const numMatch = lower.match(/\b(\d+)\b/);
      if (numMatch && (lower.includes('day') || lower.includes('month'))) {
        return { noticePeriodDays: parseInt(numMatch[1], 10) };
      }
      return {};
    },
  },
  f2f_interview_availability: {
    label: 'F2F Interview Availability',
    description: 'Availability to visit Corporate HQ at Sector 67 Gurugram',
    samplePhrases: [
      'invite you for a face-to-face interview',
      'available for an in-person meeting',
      'm3m urbana business park, sector 67',
      'f2f interview',
    ],
    priorityOrder: 17,
    extractFacts: (text) => {
      const lower = text.toLowerCase();
      if (lower.includes('yes') || lower.includes('sure') || lower.includes('haan') || lower.includes('available') || lower.includes('tomorrow') || lower.includes('kal')) {
        return { interviewVenueConfirmed: true };
      }
      return {};
    },
  },
  f2f_interview_slot: {
    label: 'F2F Interview Slot Booking',
    description: 'Specific date and time slot confirmation',
    samplePhrases: [
      'which slot works best for you',
      'slots available on',
      'confirm your interview for',
      'tomorrow at 2:30 pm',
    ],
    priorityOrder: 18,
    extractFacts: (text) => {
      const lower = text.toLowerCase();
      if (lower.includes('2:30') || lower.includes('4:30') || lower.includes('tomorrow') || lower.includes('friday') || lower.includes('slot-2') || lower.includes('slot-3') || lower.includes('slot-4') || lower.includes('perfect') || lower.includes('confirm')) {
        return { interviewSlotConfirmed: true, slotDetails: text.trim() };
      }
      return {};
    },
  },
  candidate_questions: {
    label: 'Candidate Inquiry Resolution',
    description: 'Questions asked by candidate (timings, office address, leads, benefits, etc.)',
    samplePhrases: [
      'where is your office',
      'working hours',
      'office timings',
      'leads support',
      'cab facility',
      'about the company',
    ],
    priorityOrder: 0,
    extractFacts: () => ({}),
  },
  busy_callback_time: {
    label: 'Driving / Busy Callback Time',
    description: 'Candidate busy, requested specific callback time',
    samplePhrases: [
      'i am driving',
      'i am busy',
      'in a meeting',
      'call me back later',
      'call later',
    ],
    priorityOrder: 0,
    extractFacts: (text) => ({ callbackRequested: true, callbackDetails: text.trim() }),
  },
};

/**
 * Normalizes question text for semantic duplicate checking.
 */
export function normalizeQuestionText(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detects the canonical topic of an agent or candidate utterance.
 */
export function detectQuestionTopic(questionText: string): QuestionTopic | null {
  const norm = normalizeQuestionText(questionText);

  for (const [topic, def] of Object.entries(TOPIC_SEMANTIC_PATTERNS) as [QuestionTopic, typeof TOPIC_SEMANTIC_PATTERNS[QuestionTopic]][]) {
    for (const phrase of def.samplePhrases) {
      if (norm.includes(normalizeQuestionText(phrase))) {
        return topic;
      }
    }
  }

  // Heuristic fallbacks
  if (norm.includes('year') && (norm.includes('experience') || norm.includes('sales'))) {
    return 'total_real_estate_experience';
  }
  if (norm.includes('company') || norm.includes('employer') || norm.includes('organization')) {
    return 'current_company';
  }
  if (norm.includes('designation') || norm.includes('role') || norm.includes('title')) {
    return 'current_designation';
  }
  if (norm.includes('salary') || norm.includes('ctc') || norm.includes('package') || norm.includes('compensation')) {
    if (norm.includes('expected') || norm.includes('next')) {
      return 'expected_salary';
    }
    return 'current_salary';
  }
  if (norm.includes('notice') || norm.includes('join') || norm.includes('earliest')) {
    return 'notice_period';
  }
  if (norm.includes('gurgaon') || norm.includes('gurugram') || norm.includes('spr') || norm.includes('golf course')) {
    return 'gurgaon_experience';
  }
  if (norm.includes('dubai') || norm.includes('offplan')) {
    return 'dubai_experience';
  }
  if (norm.includes('slot') || norm.includes('interview') || norm.includes('m3m urbana')) {
    return 'f2f_interview_slot';
  }

  return null;
}

/**
 * Initialize a fresh Question State Engine instance.
 */
export function createInitialQuestionStateEngine(candidate?: any): QuestionStateEngine {
  const initialFacts: Record<string, any> = {};
  const answeredTopics: string[] = [];

  if (candidate?.screening?.currentCompany) {
    initialFacts.currentCompany = candidate.screening.currentCompany;
    answeredTopics.push('current_company');
  }
  if (candidate?.screening?.currentDesignation) {
    initialFacts.currentDesignation = candidate.screening.currentDesignation;
    answeredTopics.push('current_designation');
  }
  if (candidate?.screening?.totalExperienceYears || candidate?.screening?.realEstateExperienceYears) {
    const exp = candidate.screening.realEstateExperienceYears || candidate.screening.totalExperienceYears;
    initialFacts.totalExperienceYears = exp;
    initialFacts.realEstateExperienceYears = exp;
    answeredTopics.push('total_real_estate_experience');
  }
  if (candidate?.screening?.currentSalaryLPA) {
    initialFacts.currentSalaryLPA = candidate.screening.currentSalaryLPA;
    answeredTopics.push('current_salary');
  }
  if (candidate?.screening?.expectedSalaryLPA) {
    initialFacts.expectedSalaryLPA = candidate.screening.expectedSalaryLPA;
    answeredTopics.push('expected_salary');
  }
  if (candidate?.screening?.noticePeriodDays !== undefined) {
    initialFacts.noticePeriodDays = candidate.screening.noticePeriodDays;
    answeredTopics.push('notice_period');
  }

  const allTopics: QuestionTopic[] = [
    'identity_permission',
    'target_role',
    'current_company',
    'current_designation',
    'total_real_estate_experience',
    'gurgaon_experience',
    'developer_projects',
    'residential_luxury_ticket_size',
    'current_salary',
    'expected_salary',
    'notice_period',
    'f2f_interview_slot',
  ];

  const openTopics = allTopics.filter((t) => !answeredTopics.includes(t));

  return {
    activeQuestionId: null,
    activeQuestion: null,
    activeTopic: null,
    questionStatus: 'QUESTION_GENERATED',
    lastSpokenQuestion: null,
    askedQuestions: [],
    answeredTopics,
    openTopics,
    candidateFacts: initialFacts,
    pendingClarifications: [],
    contradictions: [],
  };
}

/**
 * Core Intelligence Gate: Evaluates proposed question through 7 strict validation checks.
 */
export interface GateCheckResult {
  passed: boolean;
  rejectReason?: string;
  suggestedAction: 'ASK_NEXT_QUESTION' | 'DO_NOT_ASK' | 'SEEK_CLARIFICATION' | 'WAIT_FOR_COMPLETION';
  clarificationPrompt?: string;
  detectedTopic: QuestionTopic | null;
}

export function evaluateQuestionGate(
  proposedQuestion: string,
  state: QuestionStateEngine,
  isCandidateStillSpeaking: boolean = false
): GateCheckResult {
  const normProposed = normalizeQuestionText(proposedQuestion);
  const detectedTopic = detectQuestionTopic(proposedQuestion);

  // CHECK 1: Active Question Lock - Is previous question still waiting for answer?
  if (state.activeQuestionId && state.questionStatus === 'WAIT_FOR_ANSWER' && !isCandidateStillSpeaking) {
    // If the proposed question is just the active question, it's a re-prompt; reject duplicate unless explicit
    if (state.activeQuestion && normalizeQuestionText(state.activeQuestion) === normProposed) {
      return {
        passed: false,
        rejectReason: `ACTIVE_QUESTION_LOCK: Question ${state.activeQuestionId} is currently active and awaiting answer. Do not re-ask.`,
        suggestedAction: 'DO_NOT_ASK',
        detectedTopic,
      };
    }
  }

  // CHECK 2: Is candidate currently speaking?
  if (isCandidateStillSpeaking) {
    return {
      passed: false,
      rejectReason: 'CANDIDATE_SPEAKING: Candidate is still speaking. Floor belongs to candidate.',
      suggestedAction: 'WAIT_FOR_COMPLETION',
      detectedTopic,
    };
  }

  // CHECK 3: Is proposed question exactly or nearly identical to already asked question?
  const exactMatch = state.askedQuestions.find(
    (q) => q.normalizedQuestion === normProposed || normProposed.includes(q.normalizedQuestion) || q.normalizedQuestion.includes(normProposed)
  );
  if (exactMatch && exactMatch.answerStatus === 'ANSWERED') {
    return {
      passed: false,
      rejectReason: `DUPLICATE_QUESTION: Exactly/semantically identical to asked question ${exactMatch.questionId} (${exactMatch.exactQuestion}) which was already answered.`,
      suggestedAction: 'DO_NOT_ASK',
      detectedTopic,
    };
  }

  // CHECK 4: Is proposed question semantically equivalent to a completed topic?
  if (detectedTopic && state.answeredTopics.includes(detectedTopic)) {
    // Check if it adds NEW sub-dimension (valid follow-up)
    const topicAsked = state.askedQuestions.filter((q) => q.topic === detectedTopic);
    if (topicAsked.length > 0) {
      const isSubDimension =
        (detectedTopic === 'total_real_estate_experience' && normProposed.includes('gurgaon')) ||
        (detectedTopic === 'current_company' && normProposed.includes('team size')) ||
        (detectedTopic === 'current_salary' && normProposed.includes('in hand'));

      if (!isSubDimension) {
        return {
          passed: false,
          rejectReason: `TOPIC_ALREADY_COMPLETE: Topic "${detectedTopic}" is already complete. Semantic duplicate forbidden.`,
          suggestedAction: 'DO_NOT_ASK',
          detectedTopic,
        };
      }
    }
  }

  // CHECK 5: Has this information already been provided voluntarily in candidate facts?
  if (detectedTopic) {
    if (detectedTopic === 'total_real_estate_experience' && state.candidateFacts.totalExperienceYears !== undefined) {
      return {
        passed: false,
        rejectReason: `FACT_ALREADY_KNOWN: Real estate experience (${state.candidateFacts.totalExperienceYears} years) already provided voluntarily.`,
        suggestedAction: 'DO_NOT_ASK',
        detectedTopic,
      };
    }
    if (detectedTopic === 'current_company' && state.candidateFacts.currentCompany) {
      return {
        passed: false,
        rejectReason: `FACT_ALREADY_KNOWN: Current company (${state.candidateFacts.currentCompany}) already provided voluntarily.`,
        suggestedAction: 'DO_NOT_ASK',
        detectedTopic,
      };
    }
    if (detectedTopic === 'current_designation' && state.candidateFacts.currentDesignation) {
      return {
        passed: false,
        rejectReason: `FACT_ALREADY_KNOWN: Current designation (${state.candidateFacts.currentDesignation}) already known.`,
        suggestedAction: 'DO_NOT_ASK',
        detectedTopic,
      };
    }
    if (detectedTopic === 'notice_period' && state.candidateFacts.noticePeriodDays !== undefined) {
      return {
        passed: false,
        rejectReason: `FACT_ALREADY_KNOWN: Notice period (${state.candidateFacts.noticePeriodDays} days) already known.`,
        suggestedAction: 'DO_NOT_ASK',
        detectedTopic,
      };
    }
  }

  // CHECK 6: Check for pending contradictions
  if (state.pendingClarifications.length > 0) {
    const contradiction = state.contradictions.find((c) => c.status === 'PENDING_CLARIFICATION');
    if (contradiction) {
      return {
        passed: false,
        rejectReason: 'CONTRADICTION_PENDING: Candidate gave contradictory information; clarification required first.',
        suggestedAction: 'SEEK_CLARIFICATION',
        clarificationPrompt: `Earlier you mentioned ${contradiction.previousValue}, and now I heard ${contradiction.newValue}. Could you clarify which figure is correct?`,
        detectedTopic,
      };
    }
  }

  // All checks passed!
  return {
    passed: true,
    suggestedAction: 'ASK_NEXT_QUESTION',
    detectedTopic,
  };
}

/**
 * Transition question state when an agent speaks a question.
 */
export function recordQuestionSpoken(
  state: QuestionStateEngine,
  questionText: string,
  topicOverride?: QuestionTopic
): QuestionStateEngine {
  const topic = topicOverride || detectQuestionTopic(questionText) || 'candidate_questions';
  const questionCount = state.askedQuestions.length + 1;
  const questionId = `Q${String(questionCount).padStart(3, '0')}`;
  const norm = normalizeQuestionText(questionText);

  const newRecord: AskedQuestionRecord = {
    questionId,
    exactQuestion: questionText,
    normalizedQuestion: norm,
    topic,
    timestamp: new Date().toISOString(),
    answerStatus: 'WAITING',
    whetherFollowUpWasNeeded: false,
  };

  return {
    ...state,
    activeQuestionId: questionId,
    activeQuestion: questionText,
    activeTopic: topic,
    questionStatus: 'WAIT_FOR_ANSWER',
    lastSpokenQuestion: questionText,
    askedQuestions: [...state.askedQuestions, newRecord],
  };
}

/**
 * Transition question state when candidate answers.
 * Detects facts, contradictions, closes active question, updates answered topics.
 */
export function recordAnswerReceived(
  state: QuestionStateEngine,
  candidateAnswer: string
): { updatedState: QuestionStateEngine; extractedFacts: Record<string, any>; detectedContradiction: boolean } {
  const lower = candidateAnswer.toLowerCase();
  const updatedFacts = { ...state.candidateFacts };
  const updatedAnsweredTopics = new Set(state.answeredTopics);
  let detectedContradiction = false;
  const newContradictions = [...state.contradictions];
  const newPendingClarifications = [...state.pendingClarifications];

  // 1. Extract facts based on active topic or general scan across all topics
  for (const [topicKey, def] of Object.entries(TOPIC_SEMANTIC_PATTERNS) as [QuestionTopic, typeof TOPIC_SEMANTIC_PATTERNS[QuestionTopic]][]) {
    const facts = def.extractFacts(candidateAnswer, state.candidateFacts);
    if (Object.keys(facts).length > 0) {
      // Check for contradiction in numeric fields
      if (facts.totalExperienceYears !== undefined && updatedFacts.totalExperienceYears !== undefined) {
        if (facts.totalExperienceYears !== updatedFacts.totalExperienceYears) {
          detectedContradiction = true;
          newContradictions.push({
            topic: 'total_real_estate_experience',
            previousValue: `${updatedFacts.totalExperienceYears} years`,
            newValue: `${facts.totalExperienceYears} years`,
            status: 'PENDING_CLARIFICATION',
            timestamp: new Date().toISOString(),
          });
          newPendingClarifications.push(
            `Contradiction on real estate experience: previously ${updatedFacts.totalExperienceYears} yrs vs newly stated ${facts.totalExperienceYears} yrs.`
          );
        }
      }

      Object.assign(updatedFacts, facts);
      updatedAnsweredTopics.add(topicKey);
    }
  }

  // 2. Close active question if answered
  const updatedAskedQuestions = state.askedQuestions.map((q) => {
    if (q.questionId === state.activeQuestionId) {
      return {
        ...q,
        candidateAnswer,
        answerStatus: 'ANSWERED' as const,
      };
    }
    return q;
  });

  if (state.activeTopic) {
    updatedAnsweredTopics.add(state.activeTopic);
  }

  const answeredTopicsArray = Array.from(updatedAnsweredTopics);
  const openTopicsArray = state.openTopics.filter((t) => !answeredTopicsArray.includes(t));

  const updatedState: QuestionStateEngine = {
    ...state,
    activeQuestionId: null,
    activeQuestion: null,
    activeTopic: null,
    questionStatus: 'QUESTION_CLOSED',
    askedQuestions: updatedAskedQuestions,
    answeredTopics: answeredTopicsArray,
    openTopics: openTopicsArray,
    candidateFacts: updatedFacts,
    pendingClarifications: newPendingClarifications,
    contradictions: newContradictions,
  };

  return {
    updatedState,
    extractedFacts: updatedFacts,
    detectedContradiction,
  };
}

/**
 * Helper to select the highest priority next topic that is still uncollected.
 */
export function getNextPriorityOpenTopic(state: QuestionStateEngine): QuestionTopic | null {
  const priorityList: QuestionTopic[] = [
    'identity_permission',
    'target_role',
    'current_company',
    'current_designation',
    'total_real_estate_experience',
    'gurgaon_experience',
    'developer_projects',
    'residential_luxury_ticket_size',
    'current_salary',
    'expected_salary',
    'notice_period',
    'f2f_interview_slot',
  ];

  for (const topic of priorityList) {
    if (!state.answeredTopics.includes(topic)) {
      return topic;
    }
  }

  return null;
}
