# B2C store writers at b4380fa (Phase 1 step 0, read-only scan)

Every `save('<store>')` / `sset('<store>')` call site in `public/index.html`, grouped by enclosing function, with the permission calls found in that function's body. "No permission call in function" means the gate, if any, is in the caller or the screen that renders the control. Functions named `migrate*`, `align*`, `heal*`, `seed*` run at page load in **every** user's browser (boot sequence H:35815-35870).

### accessRequests (3 call sites)
- sendAccessRequest H:37285 — no permission call in function
- approveAccessRequest H:37411 — no permission call in function
- rejectAccessRequest H:37446 — no permission call in function
### amcs (2 call sites)
- migrateSchemeAmcNames H:9634 — no permission call in function
- impBackWrite H:69996 — no permission call in function
### apiConnectors (5 call sites)
- apiRunSync H:72041 — no permission call in function
- apiDrainInbox H:72093 — no permission call in function
- apiToggleConnector H:72252 — no permission call in function
- saveApiConnector H:72616 — no permission call in function
- apiTestResult H:72656 — no permission call in function
### apiInbox (1 call sites)
- apiDrainInbox H:72091 — no permission call in function
### apiReqLog (1 call sites)
- apiCall H:71866 — no permission call in function
### apiSyncRuns (2 call sites)
- apiRunSync H:72042 — no permission call in function
- apiDrainInbox H:72092 — no permission call in function
### auditLog (6 call sites)
- auditResume H:35138 — no permission call in function
- logAudit H:35143 — no permission call in function
- bulkEditApply H:42053 — no permission call in function
- confirmSystemReset H:55692 — isAdmin()
- confirmRestoreBackup H:55944 — isAdmin()
- apiApplyRows_ H:71970 — no permission call in function
### aumMonthly (1 call sites)
- aumLedgerRecord H:86787 — no permission call in function
### automationExecutionLog (2 call sites)
- automationRan H:56277 — no permission call in function
- runAutomationRule H:57043 — no permission call in function
### automationRules (6 call sites)
- runAutomationRule H:57044 — no permission call in function
- runDailyAutomations H:57175 — no permission call in function
- saveAutomationRule H:57710 — no permission call in function
- confirmToggleAutomationRule H:57749 — no permission call in function
- cloneAutomationRule H:57766 — no permission call in function
- deleteAutomationRule H:57794 — no permission call in function
### backupHistory (1 call sites)
- downloadBackup H:55976 — canAdmin('manageModuleSettings')
### businessEntries (18 call sites)
- migrateDbtTypes H:9240 — no permission call in function
- migrateDirectCallToCms H:9738 — no permission call in function
- planDbtUpsert H:21658,21670 — no permission call in function
- planRaiseDbtHierarchy H:21978 — no permission call in function
- submitStageDbt H:28442 — no permission call in function
- upsertLeadDbtEntry H:30046 — no permission call in function
- dbtRaiseEntry H:46438,46445 — no permission call in function
- ensureAllocationFromDbt H:46683 — no permission call in function
- submitExecPlan H:46813 — no permission call in function
- djtComplete H:51070 — can('DST','edit') can('Meetings','edit') can('Business','edit')
- mapBusinessToGoal H:51394 — no permission call in function
- saveBusinessEntry H:51737 — no permission call in function
- txnRecogniseBusiness H:52700 — no permission call in function
- autoTrigger H:56815 — no permission call in function
- createDbtFromApprovedPlan H:65155 — no permission call in function
- onAllocationAccepted H:65581 — no permission call in function
### callEntries (6 call sites)
- submitScheduleMeeting H:13924 — no permission call in function
- submitLogWarmCall H:14221 — no permission call in function
- submitScheduleWarmCall H:14292 — no permission call in function
- submitCompleteWarmCall H:14392 — no permission call in function
- migrateWarmCallsOutOfMeetings H:14668 — no permission call in function
- saveCall H:49106 — no permission call in function
### campaignRecipients (3 call sites)
- runDripJourneys H:53456 — no permission call in function
- confirmSendCampaign H:54426 — can('Campaigns','edit')
- markRecipient H:54504 — no permission call in function
### campaignTemplates (3 call sites)
- saveTemplate H:54298 — no permission call in function
- duplicateTemplate H:54315 — no permission call in function
- toggleTemplate H:54320 — no permission call in function
### campaigns (4 call sites)
- toggleDrip H:53368 — can('Campaigns','edit')
- runDripJourneys H:53457 — no permission call in function
- cwBuildCampaign H:54150 — no permission call in function
- confirmSendCampaign H:54426 — can('Campaigns','edit')
### clientDocuments (3 call sites)
- saveClientDoc H:44368 — no permission call in function
- deleteClientDoc H:44378 — can('CMS','edit')
- cmsHealthCertSave H:44625 — no permission call in function
### clientFeedback (1 call sites)
- saveFeedback H:44341 — no permission call in function
### clientGoals (5 call sites)
- saveGoal H:44205 — can('CMS','edit')
- deleteGoal H:44213 — can('CMS','edit')
- importGoalsFromRiskProfile H:44238 — can('CMS','edit')
- saveBusinessNewGoal H:51380 — no permission call in function
- saveTxnNewGoal H:52647 — can('CMS','edit')
### clients (60 call sites)
- saveClientFormFill H:11923 — no permission call in function
- recordPaperCif H:11957 — no permission call in function
- setDocsVerifyAnswer H:12397 — can('CMS','edit')
- submitDocsVerify H:12412 — can('CMS','edit')
- setPlatformActivation H:12803 — no permission call in function
- submitOrderRefs H:12926 — no permission call in function
- setOrderLineAllotted H:12946 — can('CMS','edit')
- setOrderLineRejected H:12977 — can('CMS','edit')
- markPlaceOrderReviewed H:13114 — no permission call in function
- submitScheduleMeeting H:13891 — no permission call in function
- reconcilePlanSubmissions H:14899 — no permission call in function
- iseqHealRecords H:25303 — no permission call in function
- submitSendCif H:27336,27342 — no permission call in function
- submitSendCtForm H:27517 — no permission call in function
- submitSendReport H:27685,27702 — no permission call in function
- submitSendMom H:28180 — no permission call in function
- submitInsuranceStep H:29073 — no permission call in function
- insuranceAfterStep H:29218 — no permission call in function
- insRecordPaperCif H:29421 — no permission call in function
- insCloseCmsJourney H:29630 — no permission call in function
- migrateInsuranceToModules H:29648 — no permission call in function
- convertLeadIntoClient H:30141 — no permission call in function
- migrateConvertedLeadsOutOfLms H:30182 — no permission call in function
- sendWelcomeMessage H:30198 — no permission call in function
- handleBlueprintSideEffect H:30743,30745,30753,30761… — no permission call in function
- clientSupportToken H:31183 — no permission call in function
- migrateToConfiguredModules H:34706 — no permission call in function
- seedIfEmpty H:35228 — no permission call in function
- saveClient H:44838 — no permission call in function
- runArcCycle H:49633 — no permission call in function
- saveArcSchedule H:49674 — can('Meetings','create')
- applyArcRecalc H:49710 — no permission call in function
- submitDocForm H:65901 — no permission call in function
- submitUnifiedClientForm H:66494 — no permission call in function
- autoAdvanceOnCifSubmission H:66618 — no permission call in function
- impCommit H:68714 — no permission call in function
### commissionRates (1 call sites)
- migrateAwayFromLevelsAndIncentives H:34630 — no permission call in function
### communications (1 call sites)
- logCommunication H:44086 — no permission call in function
### complianceItems (1 call sites)
- cycleComplianceItem H:55189 — canAdmin('manageModuleSettings')
### config (116 call sites)
- setModuleRoles H:6112 — no permission call in function
- alignDepartmentsOnce H:6479 — no permission call in function
- addStarterDepartments H:6494 — no permission call in function
- healDepartments H:6566 — no permission call in function
- alignRolesOnce H:6729 — no permission call in function
- addRole H:6774 — no permission call in function
- removeRole H:6835 — no permission call in function
- setFormActive H:7583 — canAdmin('manageFields')
- migrateFqTaskName H:9233 — no permission call in function
- migrateRecommendationWording H:9360 — no permission call in function
- migrateMultiGoalBlueprint H:9541 — no permission call in function
- migrateBusinessDeclined H:9573 — no permission call in function
- alignConfigListOnce H:9700 — no permission call in function
- retireBisForms H:9770 — no permission call in function
- installFqStageAssessments H:9808 — no permission call in function
- migrateIseqToWorkbookSet H:9875 — no permission call in function
- migrateFqToWorkbookSet H:9942 — no permission call in function
- migrateFqAssessmentCopy H:9969 — no permission call in function
- migrateFqStageAgeCopy H:9997 — no permission call in function
- migrateFqDropAgeFields H:10019 — no permission call in function
- replaceLegacyFqAssessment H:10035 — no permission call in function
- migrateFormContent H:10078 — no permission call in function
- migrateMeetingNames H:14589 — no permission call in function
- migrateRetireTransactionForms H:14632 — no permission call in function
- migrateAwayFromLevelsAndIncentives H:34620 — no permission call in function
- healMailSignOffs H:35401 — no permission call in function
- clearAccidentalStageDenies H:35427 — no permission call in function
- setViewActive H:36805 — canAdmin('manageWorkflows')
- setModuleActive H:36866 — canAdmin('manageWorkflows')
- dashSave H:39100 — no permission call in function
- dashResetAll H:39298 — no permission call in function
- saveTaskBankEntry H:46118 — canAdmin('manageWorkflows')
- deleteTaskBankEntry H:46125 — canAdmin('manageWorkflows')
- saveSubTaskTemplate H:46143 — no permission call in function
- removeSubTaskTemplate H:46148 — no permission call in function
- saveMultiProductFields H:52888 — no permission call in function
- lexiSetZone H:60046 — isAdmin()
- lexiSetPe H:60071 — isAdmin()
- lexiSetBands H:60080 — isAdmin()
- connectorGuideShot H:61699 — no permission call in function
- connectorGuideShotClear H:61707 — no permission call in function
- saveConnectorGuide H:61721 — no permission call in function
- resetConnectorGuide H:61728 — no permission call in function
- impSetMap H:68271 — no permission call in function
- impResetMap H:68277 — no permission call in function
- setRoleCapability H:72978 — isAdmin()
- closeSetupForRole H:73008 — no permission call in function
- saveRoleTemplate H:74100 — no permission call in function
- clearRoleTemplate H:74124 — no permission call in function
- setAppearance H:76150 — canAdmin('manageModuleSettings')
- resetAppearance H:76159 — no permission call in function
- saveAiNote H:76360 — no permission call in function
- deleteAiNote H:76370 — no permission call in function
- handleLogoUpload H:76514 — no permission call in function
- clearLogo H:76522 — canAdmin('manageModuleSettings')
- saveCompanySettings H:76535 — canAdmin('manageModuleSettings')
- saveAllocDraft H:76569 — canAdmin('manageFields')
- migrateMailTemplateWording H:76760 — no permission call in function
- saveIseqCategoryNotes H:76962 — canAdmin('manageFields')
- saveIseqScoring H:77044 — canAdmin('manageFields')
- saveFqContact H:77441 — canAdmin('manageFields')
- saveFqSections H:77467 — canAdmin('manageFields')
- applyFqWeights H:77495 — canAdmin('manageFields')
- saveFqMotivate H:77544 — canAdmin('manageFields')
- saveFqBands H:77584 — canAdmin('manageFields')
- saveFqQuestion H:77679,77690 — canAdmin('manageFields')
- deleteFqQuestion H:77703 — canAdmin('manageFields')
- moveFqQuestion H:77719 — canAdmin('manageFields')
- saveFqStage H:77746 — canAdmin('manageFields')
- resetFqAssessment H:77761 — canAdmin('manageFields')
- setCifFieldFlag H:77891 — canAdmin('manageFields')
- toggleCifRule H:77902 — canAdmin('manageFields')
- saveMailTemplate H:78156 — canAdmin('manageFields')
- resetMailTemplate H:78165 — canAdmin('manageFields')
- saveFormField H:78330 — canAdmin('manageFields')
- deleteFormField H:78347 — canAdmin('manageFields')
- moveFormField H:78358 — canAdmin('manageFields')
- setMailOutflow H:78998 — no permission call in function
- addMailStage H:79033 — no permission call in function
- removeMailStage H:79042 — no permission call in function
- setMailTemplateActive H:79069 — no permission call in function
- addMailTemplate H:79088 — no permission call in function
- removeMailTemplate H:79100 — no permission call in function
- addMailRule H:79125 — no permission call in function
- setMailRuleActive H:79134 — no permission call in function
- setMailRuleTemplate H:79142 — no permission call in function
- removeMailRule H:79150 — no permission call in function
- setMailModuleActive H:79193 — no permission call in function
- setMailTemplateModule H:79214 — no permission call in function
- setScoreBandNote H:80212 — canAdmin('manageFields')
- saveFormSettings H:80498 — no permission call in function
- createFormTemplate H:80534 — no permission call in function
- duplicateForm H:80552 — no permission call in function
- deleteFormTemplate H:80564 — no permission call in function
- addScoreBand H:80710 — canAdmin('manageFields')
- removeScoreBand H:80717 — canAdmin('manageFields')
- saveCustomField H:80860 — canAdmin('manageFields')
- deleteCustomField H:80867 — canAdmin('manageFields')
- addFieldOption H:80878 — canAdmin('manageFields')
- setFieldSecurity H:80888 — canAdmin('manageFields')
- renameStage H:80959 — canAdmin('manageWorkflows')
- insertStage H:80981 — canAdmin('manageWorkflows')
- deleteStage H:81007 — canAdmin('manageWorkflows')
- resetBlueprint H:81015 — canAdmin('manageWorkflows')
- addDepartment H:81106 — no permission call in function
- renameDepartment H:81129 — no permission call in function
- toggleDepartment H:81143 — no permission call in function
- removeDepartment H:81158 — no permission call in function
- addBranch H:81177 — canAdmin('manageModuleSettings')
- removeBranch H:81185 — canAdmin('manageModuleSettings')
- incSettleQuery H:85901 — no permission call in function
- incCfgSet H:86243 — no permission call in function
- apprSetGrowth H:86989 — hrIsAdmin() isAdmin()
- apprSetDefaultRole H:87040 — hrIsAdmin() isAdmin()
- apprSetRoleMap H:87052 — hrIsAdmin() isAdmin()
### darkModePref (1 call sites)
- toggleDarkMode H:36973 — no permission call in function
### djtEntries (1 call sites)
- saveDjtEntry H:51202 — no permission call in function
### docLinks (10 call sites)
- submitSendPlanForm H:27275 — no permission call in function
- convertLeadIntoClient H:30137 — no permission call in function
- migrateConvertedLeadsOutOfLms H:30182 — no permission call in function
- deliverAllocationToClient H:48101 — no permission call in function
- createDocLink H:63516 — no permission call in function
- submitBlueprintDecision H:65070 — no permission call in function
- submitAllocationDecision H:65391 — no permission call in function
- onAllocationDeclined H:65418 — no permission call in function
- submitDocForm H:65814 — no permission call in function
- submitUnifiedClientForm H:66445 — no permission call in function
### docSubmissions (9 call sites)
- recordInAppSubmission H:26517 — no permission call in function
- submitBlueprintDecision H:65070 — no permission call in function
- submitAllocationDecision H:65379 — no permission call in function
- submitDocForm H:65832,65876,65904,65910 — no permission call in function
- submitUnifiedClientForm H:66497,66500 — no permission call in function
### errorLog (5 call sites)
- runAutomationRule H:57030 — no permission call in function
- runAutomationRules H:57055 — no permission call in function
- retryError H:57977 — canAdmin('manageWorkflows')
- testConnector H:61837 — canAdmin('manageModuleSettings')
- testWebhook H:61904 — no permission call in function
### exportHistory (1 call sites)
- exportRecord H:69683 — no permission call in function
### hrAppraisals (6 call sites)
- apprOpen H:86923 — no permission call in function
- apprSetRating H:86953 — no permission call in function
- apprSetKpi H:86961 — no permission call in function
- apprTakeAuto H:86976 — no permission call in function
- apprFinalise H:87014 — no permission call in function
- apprReopen H:87033 — hrIsAdmin() isAdmin()
### hrAttendance (3 call sites)
- hrSaveAttendance H:81853 — no permission call in function
- hrActBeat H:82111 — no permission call in function
- hrActReconcile H:82131 — no permission call in function
### hrCompOff (3 call sites)
- hrCompOffSync H:84259,84270 — no permission call in function
- hrDecideCompOff H:84338 — no permission call in function
### hrConfig (1 call sites)
- hrCfgSave H:81406 — hrIsAdmin()
### hrIncentives (8 call sites)
- incOpenSheet H:85770 — no permission call in function
- incAddRow H:85792 — no permission call in function
- incDropRow H:85799 — no permission call in function
- incSetCell H:85807 — no permission call in function
- incSetHeader H:85814 — no permission call in function
- incRefillCounts H:85821 — no permission call in function
- incFinalise H:85855 — no permission call in function
- incReopen H:85875 — no permission call in function
### hrLeave (3 call sites)
- hrSubmitLeaveRequest H:83757 — no permission call in function
- hrCancelLeave H:83875 — hrIsAdmin()
- hrDecideLeave H:83985 — no permission call in function
### hrRegularizations (2 call sites)
- hrSubmitRegularize H:84686 — no permission call in function
- hrDecideReg H:84780 — no permission call in function
### hrSourceMaps (2 call sites)
- hrSourceToggle H:82466 — hrIsAdmin()
- hrSourceSetField H:82484 — hrIsAdmin()
### importBatches (1 call sites)
- impCommit H:68722 — no permission call in function
### importHistory (5 call sites)
- impCommit H:68728 — no permission call in function
- zohoWizardConfirmImport H:69434 — no permission call in function
- impBackApply H:70209 — no permission call in function
- mapImpApply H:71326 — no permission call in function
- deleteImport H:71545 — no permission call in function
### importUndo (2 call sites)
- impUndoRecord H:70051 — no permission call in function
- deleteImport H:71542 — no permission call in function
### insPolicies (5 call sites)
- insPolicyFromClient H:29571 — no permission call in function
- migrateInsuranceToModules H:29643 — no permission call in function
- submitInsPolicyStep H:29807 — no permission call in function
- insPolicyAfterStep H:29837 — no permission call in function
- insPptComplete H:29861 — no permission call in function
### leads (55 call sites)
- planModifyAfterDecline H:11543 — can('LMS', 'edit')
- planResubmitForConsent H:11563 — no permission call in function
- submitLogWarmCall H:14221 — no permission call in function
- submitScheduleWarmCall H:14276 — no permission call in function
- submitCompleteWarmCall H:14392 — no permission call in function
- migrateTransactionApproach H:14488 — no permission call in function
- migrateInspiringToFsl H:14520 — no permission call in function
- reconcilePlanSubmissions H:14898 — no permission call in function
- iseqHealRecords H:25302 — no permission call in function
- setPlanAllocatable H:26001 — no permission call in function
- setPlanLine H:26026 — no permission call in function
- addPlanLine H:26034 — no permission call in function
- splitPlanLine H:26053 — no permission call in function
- savePlanLineGoal H:26114 — no permission call in function
- removePlanLine H:26123 — no permission call in function
- resetPlanAllocation H:26133 — no permission call in function
- submitInvestmentApproach H:26489 — no permission call in function
- submitPlanInputSheet H:26572 — no permission call in function
- preparePlanFromStage H:26612 — no permission call in function
- modifyPlanFromOutput H:26662 — no permission call in function
- sendPlanForApproval H:26716 — no permission call in function
- planFormSeedBasics H:26782 — no permission call in function
- savePlanFormPage H:27022 — no permission call in function
- saveLeadFormFill H:27124 — no permission call in function
- submitSendDataGathering H:27193,27207 — no permission call in function
- submitSendPlanForm H:27275 — no permission call in function
- planClientLink H:28142 — no permission call in function
- submitStageDbt H:28442 — no permission call in function
- approveBlueprint H:28585 — no permission call in function
- convertLeadIntoClient H:30141 — no permission call in function
- migrateConvertedLeadsOutOfLms H:30182 — no permission call in function
- submitSendFq H:30338,30346 — no permission call in function
- prepareIseqForMinutes H:30472 — no permission call in function
- handleBlueprintSideEffect H:30567,30584,30602,30613… — no permission call in function
- migrateAwayFromLevelsAndIncentives H:34654 — no permission call in function
- seedIfEmpty H:35222 — no permission call in function
- saveLead H:42894 — no permission call in function
- submitExecPlan H:46805 — no permission call in function
- deliverAllocationToClient H:48111 — no permission call in function
- submitBlueprintDecision H:65070 — no permission call in function
- movePlanBackForChanges H:65119 — no permission call in function
- onAllocationAccepted H:65545 — no permission call in function
- submitDocForm H:65862,65895 — no permission call in function
- submitUnifiedClientForm H:66488 — no permission call in function
- openLeadsFromCtSubmission H:66595 — no permission call in function
- submitSendCustomForm H:80691 — no permission call in function
### meetings (22 call sites)
- submitScheduleMeeting H:13911,13926 — no permission call in function
- markLinkedMeeting H:13989 — no permission call in function
- submitCompleteWarmCall H:14389 — no permission call in function
- migrateMeetingNames H:14620 — no permission call in function
- migrateWarmCallsOutOfMeetings H:14668 — no permission call in function
- submitSendMom H:28187 — no permission call in function
- convertLeadIntoClient H:30129 — no permission call in function
- migrateConvertedLeadsOutOfLms H:30182 — no permission call in function
- handleBlueprintSideEffect H:30994 — no permission call in function
- migrateToConfiguredModules H:34751 — no permission call in function
- saveMeeting H:49364,49373 — no permission call in function
- arcRescheduleMeeting H:49509 — can('Meetings','edit')
- runArcCycle H:49622 — no permission call in function
- saveArcSchedule H:49674 — can('Meetings','create')
- applyArcRecalc H:49710 — no permission call in function
- saveArcMeeting H:49996,50013 — can('Meetings','edit')
- dwtCompleteSourceRecord H:50792 — can('Meetings','edit') can('DST','edit')
- djtCarryForward H:51030 — can('DST','edit') can('Meetings','edit') can('RMS','edit')
- djtComplete H:51059 — can('DST','edit') can('Meetings','edit') can('Business','edit')
### moms (2 call sites)
- saveMom H:44290 — can('Meetings','edit')
- shareMom H:44314 — can('Meetings','edit')
### multiProductSchemes (2 call sites)
- saveMultiProduct H:52922 — no permission call in function
- deleteMultiProduct H:52934 — can('Masters','delete')
### notifications (8 call sites)
- notifyUser H:36989 — no permission call in function
- notifyUsers H:37003 — no permission call in function
- markNotificationRead H:37023 — no permission call in function
- openNotification H:37047 — no permission call in function
- markAllNotificationsRead H:37053 — no permission call in function
- reminderMarkRead H:42762 — no permission call in function
- dstNotifyReassigned H:45310 — no permission call in function
- fqaSubmitMeeting H:64548 — no permission call in function
### partners (1 call sites)
- savePartner H:53128 — no permission call in function
### platformHoldings (1 call sites)
- impCommit H:68715 — no permission call in function
### platformSips (1 call sites)
- impCommit H:68716 — no permission call in function
### projectClients (4 call sites)
- toggleChecklistDone H:54921 — can('Projects','edit')
- setChecklistRemark H:54931 — can('Projects','edit')
- removeChecklistClient H:54938 — can('Projects','edit')
- acAdd H:55050 — can('Projects','edit')
### projectTasks (1 call sites)
- saveProjectTask H:55076 — no permission call in function
### projects (3 call sites)
- migrateProjects H:54609 — no permission call in function
- saveProject H:54779 — no permission call in function
- setProjectStatus H:54787 — can('Projects','edit')
### queries (6 call sites)
- saveQuery H:31412 — no permission call in function
- claimQuery H:31426 — can('Queries','edit')
- setQueryStatus H:31441 — can('Queries','edit')
- addQueryReply H:31460 — can('Queries','edit')
- submitClientQuery H:31598 — no permission call in function
- submitClientReply H:31631 — no permission call in function
### queryReplies (2 call sites)
- addQueryReply H:31460 — can('Queries','edit')
- submitClientReply H:31631 — no permission call in function
### recommendations (24 call sites)
- migrateBlueprintLinks H:9337 — no permission call in function
- migrateConsentPendingWording H:9397 — no permission call in function
- planModifyAfterDecline H:11541 — can('LMS', 'edit')
- ensureAllocHead H:21759,21770 — no permission call in function
- allocHeadRoll H:21829 — no permission call in function
- planRaiseDbtHierarchy H:21964 — no permission call in function
- setAllocationStage H:25753 — no permission call in function
- migrateDeltaToDormant H:34684 — no permission call in function
- ensureAllocationFromDbt H:46641,46682 — no permission call in function
- submitExecPlan H:46820 — no permission call in function
- markExecAllocReviewed H:46839 — no permission call in function
- ensureAllocationFromPlan H:46897,46904 — no permission call in function
- saveRecommendation H:47554 — no permission call in function
- submitAllocationForInternal H:47690 — no permission call in function
- decideAllocationInternal H:47715,47724 — canAdmin('approveAllocations')
- deliverAllocationToClient H:48101 — no permission call in function
- submitBlueprintDecision H:65062 — no permission call in function
- submitAllocationDecision H:65379 — no permission call in function
- onAllocationDeclined H:65418 — no permission call in function
- allocRaiseTransactions H:65519 — no permission call in function
### reviews (37 call sites)
- toggleRmsCheck H:11987 — no permission call in function
- submitRmsModePeople H:13756 — no permission call in function
- submitSendCtForm H:27522 — no permission call in function
- submitNextMeetingDate H:27591 — no permission call in function
- submitCloseReview H:27629 — no permission call in function
- insScheduleRmsReview H:29607,29615 — no permission call in function
- sendCtCopyAndCertificate H:30398 — no permission call in function
- handleBlueprintSideEffect H:30888,30901,30919,30928… — no permission call in function
- saveReview H:45101 — no permission call in function
- arcRescheduleMeeting H:49514 — can('Meetings','edit')
- saveArcMeeting H:50006 — can('Meetings','edit')
- djtCarryForward H:51037 — can('DST','edit') can('Meetings','edit') can('RMS','edit')
- openLeadsFromCtSubmission H:66603 — no permission call in function
### schemes (1 call sites)
- migrateSchemeAmcNames H:9634 — no permission call in function
### settings (12 call sites)
- setCfg H:5189 — no permission call in function
- migrateAllocPlans H:9190 — no permission call in function
- migrateConsentPendingWording H:9379,9389 — no permission call in function
- migrateBusinessDeclined H:9568 — no permission call in function
- alignConfigListOnce H:9700 — no permission call in function
- migrateDirectCallToCms H:9753 — no permission call in function
- migrateMeetingNames H:14601 — no permission call in function
- migrateDeltaToDormant H:34674,34680 — no permission call in function
- dwtMarkDay H:50463 — no permission call in function
- resetSettingValue H:78456 — no permission call in function
### settingsAudit (12 call sites)
- setCfg H:5189 — no permission call in function
- setModuleRoles H:6117 — no permission call in function
- migrateDeltaToDormant H:34674 — no permission call in function
- migrateToConfiguredModules H:34710 — no permission call in function
- healMailSignOffs H:35407 — no permission call in function
- clearAccidentalStageDenies H:35435 — no permission call in function
- dashAudit H:39308 — no permission call in function
- impLogMap H:68264 — no permission call in function
- resetSettingValue H:78456 — no permission call in function
- setMailOutflow H:79002 — no permission call in function
- setMailTemplateActive H:79074 — no permission call in function
- setMailModuleActive H:79197 — no permission call in function
### slaRules (4 call sites)
- removeRole H:6836 — no permission call in function
- migrateAwayFromLevelsAndIncentives H:34633 — no permission call in function
- saveSLARule H:56054 — canAdmin('manageWorkflows')
- deleteSLARule H:56060 — canAdmin('manageWorkflows')
### sops (2 call sites)
- saveSop H:77164 — canAdmin('manageFields')
- deleteSop H:77176 — canAdmin('manageFields')
### supportQueries (1 call sites)
- submitSupportQuery H:42849 — no permission call in function
### systemState (2 call sites)
- confirmSystemReset H:55694 — isAdmin()
- confirmRestoreBackup H:55947 — isAdmin()
### tasks (39 call sites)
- migrateFqTaskName H:9226 — no permission call in function
- raiseDocsVerifyTasks H:12464 — no permission call in function
- setOrderLineRejected H:12976 — can('CMS','edit')
- migrateMeetingNames H:14607 — no permission call in function
- planSyncActionsToDst H:17044 — no permission call in function
- createMomActionTasks H:28315 — no permission call in function
- createLeadDST H:28818 — no permission call in function
- completeLeadDST H:28822 — no permission call in function
- insPolicyCompleteTask H:29530 — no permission call in function
- insPolicyRaiseTask H:29544 — no permission call in function
- insPolicyFromClient H:29578 — no permission call in function
- createClientDST H:29878 — no permission call in function
- ensureOrderAuthFollowUp H:29920,29933 — no permission call in function
- ensureReinitiateTask H:29956,29964 — no permission call in function
- completeClientDST H:29969 — no permission call in function
- createReviewDST H:29996 — no permission call in function
- handleBlueprintSideEffect H:30638,30687 — no permission call in function
- saveTaskFormWrite H:45426,45449 — no permission call in function
- saveSubTaskRow H:45673,45687 — no permission call in function
- deleteSubTaskRow H:45702 — can('DST','delete')
- completeSubTask H:45861 — no permission call in function
- saveTask H:45900 — no permission call in function
- onTaskCompleted H:45921 — no permission call in function
- submitAllocationForInternal H:47700 — no permission call in function
- decideAllocationInternal H:47717 — canAdmin('approveAllocations')
- completeAllocationQueryTask H:48141 — no permission call in function
- dwtCreateServiceTask H:50675 — can('DST','create')
- dwtCompleteSourceRecord H:50806 — can('Meetings','edit') can('DST','edit')
- djtCarryForward H:51023 — can('DST','edit') can('Meetings','edit') can('RMS','edit')
- djtComplete H:51052 — can('DST','edit') can('Meetings','edit') can('Business','edit')
- runCampaignFollowups H:54465 — no permission call in function
- autoTrigger H:56711 — no permission call in function
- fqaSubmitMeeting H:64543 — no permission call in function
- onAllocationDeclined H:65431 — no permission call in function
### team (41 call sites)
- alignDepartmentsOnce H:6480 — no permission call in function
- healDepartments H:6567 — no permission call in function
- migrateQueryPermissions H:9215 — no permission call in function
- provisionMemberAccount H:31739 — no permission call in function
- migrateAwayFromLevelsAndIncentives H:34621,34642 — no permission call in function
- seedIfEmpty H:35179,35200 — no permission call in function
- clearAccidentalStageDenies H:35429 — no permission call in function
- approveAccessRequest H:37407 — no permission call in function
- applyAccessReview H:37699 — no permission call in function
- viewProfile H:42432 — no permission call in function
- saveProfileSection H:42444 — no permission call in function
- handleProfileDocUpload H:42459 — no permission call in function
- deleteProfileDoc H:42468 — no permission call in function
- toggleProfileFlag H:42476 — no permission call in function
- twoFactorLoad H:42504 — no permission call in function
- twoFactorVerify H:42568 — no permission call in function
- toggleDesktopNotifications H:42626 — no permission call in function
- reminderPrefSet H:42838 — no permission call in function
- healSignatures H:53737 — no permission call in function
- saveSignature H:53950 — no permission call in function
- resetSignature H:53981 — no permission call in function
- confirmSystemReset H:55673 — isAdmin()
- confirmRestoreBackup H:55933 — isAdmin()
- applyAccessCopy H:72911 — no permission call in function
- setRoleCapability H:72966 — isAdmin()
- closeSetupForRole H:72998 — no permission call in function
- applyModuleMatch H:73148 — no permission call in function
- saveSubUser H:74215 — no permission call in function
- setMemberMonthlySalary H:74387 — no permission call in function
- toggleMemberStatus H:74668 — can('Team','edit')
- handleMemberDocUpload H:74987 — no permission call in function
- deleteMemberDoc H:74999 — no permission call in function
- addMemberNote H:75037 — no permission call in function
- deleteMemberNote H:75046 — no permission call in function
- saveMember H:75184 — isAdmin() canAdmin('manageUsers')
- removeMember H:75263 — can('Team','delete')
- savePermissions H:75445 — isAdmin()
- renameDepartment H:81130 — no permission call in function
- incSetPersonCategory H:86278 — no permission call in function
### transactions (18 call sites)
- migrateBlueprintLinks H:9338 — no permission call in function
- raiseTransactionsFromAllocation H:13098 — can('Transactions','create')
- handleBlueprintSideEffect H:30820,30831,30843,30854… — no permission call in function
- deleteGoal H:44213 — can('CMS','edit')
- tagFolioToGoal H:44252 — can('CMS','edit')
- mainTxnRoll H:52339 — no permission call in function
- ensureMainTransaction H:52368 — no permission call in function
- txnMarkPlaced H:52469 — no permission call in function
- txnMarkAllotted H:52514 — no permission call in function
- txnMarkRejected H:52563 — no permission call in function
- saveTxnGoalMap H:52616 — no permission call in function
- saveTxnNewGoal H:52654 — can('CMS','edit')
- saveTransaction H:52727 — no permission call in function
- allocRaiseTransactions H:65514 — no permission call in function
### txnViewPref (1 call sites)
- setTxnView H:51834 — no permission call in function
### webhooks (1 call sites)
- saveWebhook H:61891 — no permission call in function
### workActivities (13 call sites)
- migrateToConfiguredModules H:34728 — no permission call in function
- reminderStarted H:42792 — can('DST', 'edit')
- dwtSaveSlot H:50642,50650 — no permission call in function
- dwtCreateServiceTask H:50675 — can('DST','create')
- dwtClearSlot H:50687,50691 — no permission call in function
- dwtSaveActual H:50774 — no permission call in function
- dwtReopenBlock H:50819 — no permission call in function
- dwtDrop H:50908 — no permission call in function
- dwtResizeStart H:50936 — no permission call in function
- djtComplete H:51065 — can('DST','edit') can('Meetings','edit') can('Business','edit')
- autoTrigger H:56841 — no permission call in function
