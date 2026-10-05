export type CommandEntrySnippetEnvironment = 'cmdEntry' | 'c4iShared' | 'cmdEntryPool';

export interface CommandEntrySnippetVariable {
    var: string;
    value: string;
}

export interface CommandEntrySqlSnippet {
    id: string;
    label: string;
    description?: string;
    variables?: CommandEntrySnippetVariable[];
    title?: string;
    stmt: string;
    group: string;
    environment?: CommandEntrySnippetEnvironment;
    singleRowResultView?: 'row' | 'column';
    order?: number;
    source: 'built-in' | 'user';
    createdAt?: string;
    updatedAt?: string;
}

// Command Entry uses two distinct user-facing log terms:
// History Log = recalled command history, and Joblog = the IBM i job message log.
export const BUILT_IN_SQL_SNIPPETS: ReadonlyArray<CommandEntrySqlSnippet> = [
    {
        id: 'builtin.lastest-joblog',
        label: 'Joblog (last 200 msgs)',
        description: '${sqlJobId}',
        title: 'Joblog (Last 200 msgs) (${sqlJobId})',
        stmt: [
            'SELECT ORDINAL_POSITION as SEQNBR,',
            '       MESSAGE_ID as MSGID, SEVERITY as SEV, ',
            "       CASE UPPER(TRIM(MESSAGE_TYPE)) WHEN 'COMMAND' THEN '*CMD' WHEN 'COMPLETION' THEN '*COMP'",
            "       WHEN 'DIAGNOSTIC' THEN '*DIAG' WHEN 'ESCAPE' THEN '*ESCAPE' WHEN 'INFORMATIONAL' THEN '*INFO'",
            "       WHEN 'INQUIRY' THEN '*INQ' WHEN 'NOTIFY' THEN '*NOTIFY' WHEN 'REPLY' THEN '*RPY'",
            "       WHEN 'REQUEST' THEN '*RQS' WHEN 'SCOPE' THEN '*SCOPE' WHEN 'SENDER' THEN '*SENDER'",
            '       ELSE MESSAGE_TYPE END AS MSGTYPE,',
            '       MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT as MSG_SECOND_LVL,',
            "   TRIM(from_library) CONCAT '/' CONCAT TRIM(from_program) CONCAT '(' CONCAT TRIM(from_instruction) CONCAT ')'",
            '      AS "FROM_PGM(Stmt)",',
            "   TRIM(to_library) CONCAT '/' CONCAT TRIM(to_program) CONCAT '(' CONCAT TRIM(to_instruction) CONCAT ')'",
            '      AS "TO_PGM(Stmt)",',
            '       QUALIFIED_JOB_NAME as JOB, MESSAGE_TIMESTAMP',
            "FROM TABLE(QSYS2.JOBLOG_INFO('${sqlJobId}'))",
            'ORDER BY ORDINAL_POSITION DESC FETCH FIRST 200 ROWS ONLY'
        ].join(' '),
        group: 'Job Info',
        environment: 'cmdEntryPool',
        singleRowResultView: 'row',
        order: 10,
        source: 'built-in'
    },
    {
        id: 'builtin.full-joblog',
        label: 'Joblog (full)',
        description: '${sqlJobId}',
        title: 'Full Joblog (${sqlJobId})',
        stmt: [
            'SELECT ORDINAL_POSITION as SEQNBR,',
            '       MESSAGE_ID as MSGID, SEVERITY as SEV, ',
            "       CASE UPPER(TRIM(MESSAGE_TYPE)) WHEN 'COMMAND' THEN '*CMD' WHEN 'COMPLETION' THEN '*COMP'",
            "       WHEN 'DIAGNOSTIC' THEN '*DIAG' WHEN 'ESCAPE' THEN '*ESCAPE' WHEN 'INFORMATIONAL' THEN '*INFO'",
            "       WHEN 'INQUIRY' THEN '*INQ' WHEN 'NOTIFY' THEN '*NOTIFY' WHEN 'REPLY' THEN '*RPY'",
            "       WHEN 'REQUEST' THEN '*RQS' WHEN 'SCOPE' THEN '*SCOPE' WHEN 'SENDER' THEN '*SENDER'",
            '       ELSE MESSAGE_TYPE END AS MSGTYPE,',
            '       MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT as MSG_SECOND_LVL,',
            "   TRIM(from_library) CONCAT '/' CONCAT TRIM(from_program) CONCAT '(' CONCAT TRIM(from_instruction) CONCAT ')'",
            '      AS "FROM_PGM(Stmt)",',
            "   TRIM(to_library) CONCAT '/' CONCAT TRIM(to_program) CONCAT '(' CONCAT TRIM(to_instruction) CONCAT ')'",
            '      AS "TO_PGM(Stmt)",',
            '       QUALIFIED_JOB_NAME as JOB, MESSAGE_TIMESTAMP',
            "FROM TABLE(QSYS2.JOBLOG_INFO('${sqlJobId}'))",
            'ORDER BY ORDINAL_POSITION DESC'
        ].join(' '),
        group: 'Job Info',
        environment: 'cmdEntryPool',
        singleRowResultView: 'row',
        order: 20,
        source: 'built-in'
    },
    {
        id: 'builtin.job-attributes',
        label: 'Job Attributes',
        description: '${sqlJobId}',
        title: 'Job Attributes for ${sqlJobId}',
        stmt: ["SELECT JOB_NAME as JOB,SUBSYSTEM,AUTHORIZATION_NAME as USER_NAME,JOB_NAME_SHORT as JOB_NAME,",
            "trim(JOB_TYPE) concat '/' concat trim(JOB_TYPE_ENHANCED) as JOB_TYPE,",
            "OPEN_FILES,",
            'JOB_STATUS,MEMORY_POOL,RUN_PRIORITY, THREAD_COUNT, TEMPORARY_STORAGE as "Temp Stg", CPU_TIME,',
            'TOTAL_DISK_IO_COUNT as "Total Disk I/O",SERVER_TYPE,ELAPSED_TIME,',
            "trim(JOB_DESCRIPTION_LIBRARY) concat '/' concat JOB_DESCRIPTION as JOB_DESC,",
            "trim(OUTPUT_QUEUE_LIBRARY) concat '/' concat OUTPUT_QUEUE as OUTPUT_QUEUE,",
            '"CCSID",DEFAULT_CCSID, LANGUAGE_ID,',
            "DATE_FORMAT, DATE_SEPARATOR, TIME_SEPARATOR,DECIMAL_FORMAT,",
            "TIMEZONE_DESCRIPTION, TIMEZONE_CURRENT_OFFSET,TIMEZONE_FULL_NAME,TIMEZONE_ABBREVIATED_NAME,",
            "JOB_ACTIVE_TIME,",
            "CLIENT_IP_ADDRESS,",
            "JOB_USER_IDENTITY_SETTING,JOB_USER_IDENTITY,",
            "SYSTEM_POOL_ID,POOL_NAME,",
            "QTEMP_SIZE,",
            "DEFAULT_WAIT,TIME_SLICE,PAGE_FAULTS, TOTAL_RESPONSE_TIME,",
            "DATABASE_LOCK_WAIT_TIME,",
            "CLIENT_ACCTNG,CLIENT_PORT,CLIENT_HOST,",
            "SERVER_MODE_CONNECTING_JOB, SERVER_MODE_CONNECTING_THREAD",
            "FROM TABLE(qsys2.active_job_info(job_name_filter => '*', DETAILED_INFO => 'ALL'))"
        ].join(' '),
        group: 'Job Info',
        environment: 'cmdEntry',
        order: 30,
        source: 'built-in'

    },
    {
        id: 'builtin.library-list',
        label: 'Library List',
        description: '${sqlJobId}',
        title: 'Library List (${sqlJobId})',
        stmt: [
            'SELECT ORDINAL_POSITION AS "Position",',
            'LIBRARY_NAME as "Library Name",',
            '"TYPE" AS "LIBL Portion",',
            'Library_Type as "Library Type",',
            'OBJECT_COUNT as "Object Count",',
            'IASP_NUMBER AS "iASP Nbr",',
            'IASP_NAME AS "iASP Name",',
            'JOB',
            "FROM TABLE(${funcLib}.JOB_LIBL('${sqlJobId}')) LL"
        ].join(' '),
        group: 'Job Info',
        environment: 'cmdEntryPool',
        order: 40,
        source: 'built-in'
    },
    {
        id: 'builtin.library-list-c4i',
        label: 'Library List (c4i)',
        description: '${c4iJobId}',
        title: 'Library List (c4i) (${c4iJobId})',
        stmt: [
            'SELECT ORDINAL_POSITION AS "Position",',
            'LIBRARY_NAME as "Library Name",',
            '"TYPE" AS "LIBL Portion",',
            'Library_Type as "Library Type",',
            'OBJECT_COUNT as "Object Count",',
            'IASP_NUMBER AS "iASP Nbr",',
            'IASP_NAME AS "iASP Name",',
            'JOB',
            "FROM TABLE(${funcLib}.JOB_LIBL('${c4iJobId}')) LL"
        ].join(' '),
        group: 'Job Info',
        environment: 'cmdEntryPool',
        order: 45,
        source: 'built-in'
    },
    {
        id: 'builtin.job-splf-list',
        label: 'SPOOLED Files List',
        description: '${sqlJobId}',
        title: 'SPOOLED Files from Job(${sqlJobId})',
        stmt: [
            'SELECT SPOOLED_FILE_NAME AS SPLFNAME,',
            'SPOOLED_FILE_NUMBER AS SPLNBR,',
            'QUALIFIED_JOB_NAME AS JOB,',
            'STATUS,TOTAL_PAGES AS PAGES,USER_DATA,FORM_TYPE,',
            'JOB_USER AS USER_NAME,',
            "TRIM(OUTPUT_QUEUE_LIBRARY) CONCAT '/' CONCAT OUTPUT_QUEUE AS OUTPUT_QUEUE,",
            'OUTPUT_PRIORITY AS OUTPTY,',
            'COPIES,SIZE,',
            'CREATION_TIMESTAMP AS CREATED,',
            'FILE_AVAILABLE AS FILE_AVAIL,',
            'ASP_NUMBER,SYSTEM AS "System Where Created",',
            "'Select ordinal_position as Rec, SPOOLED_DATA from table(systools.SPOOLED_FILE_DATA('''",
            " CONCAT QUALIFIED_JOB_NAME CONCAT",
            "''',''' CONCAT TRIM(spooled_file_name) CONCAT ''',' CONCAT spooled_file_number CONCAT ')) DSPSPLF",
            "ORDER BY ORDINAL_POSITION'",
            'AS DSPSPLF_via_SQL',
            "FROM TABLE(QSYS2.SPOOLED_FILE_INFO(JOB_NAME => '${sqlJobId}' ))",
            "WHERE (SPOOLED_FILE_NAME <> 'QPRINT' AND JOB_NAME <> 'MAPEPIRE')",
            'ORDER BY CREATION_TIMESTAMP'
        ].join(' '),
        group: 'Job Info',
        environment: 'cmdEntryPool',
        order: 90,
        source: 'built-in'
    },
    {
        id: 'builtin.last-job-spooled-file',
        label: 'View Last SPOOLED File',
        description: 'Job(${sqlJobId})',
        title: 'Last SPOOLED File for Job(${sqlJobId})',
        stmt: [
            'WITH sf AS (',
            'SELECT * FROM TABLE (qsys2.spooled_file_info(',
            "     USER_NAME => '*CURRENT', JOB_NAME => '${sqlJobId}',",
            "     STARTING_TIMESTAMP => current_date,",
            "     ENDING_TIMESTAMP => current_timestamp)) SF",
            '  ORDER BY sf.creation_timestamp DESC',
            '  LIMIT 1',
            ') ',
            'SELECT sd.SPOOLED_DATA FROM sf',
            ',LATERAL (SELECT * FROM TABLE(systools.spooled_file_data(',
            '           JOB_NAME => SF.QUALIFIED_JOB_NAME,',
            '           SPOOLED_FILE_NAME => SF.SPOOLED_FILE_NAME,',
            '           SPOOLED_FILE_NUMBER => SF.SPOOLED_FILE_NUMBER)) spd',
            ') sd'
        ].join(' '),
        group: 'Job Info',
        environment: 'cmdEntryPool',
        order: 100,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-custom',
        label: 'Active Jobs',
        description: 'sbs(${userSBSList})',
        stmt: [
            'SELECT aj.JOB_NAME as JOB, aj.SUBSYSTEM, aj.JOB_NAME_SHORT as JOB_NAME,',
            'aj.AUTHORIZATION_NAME as USER_NAME, ',
            'JOB_TYPE,JOB_STATUS,',
            " trim(aj.FUNCTION_TYPE) concat '-' concat aj.FUNCTION as FUNCTION_INFO,",
            'aj.JOB_ACTIVE_TIME as "Job Start Time",',
            'aj.CLIENT_IP_ADDRESS,',
            "trim(aj.JOB_DESCRIPTION_LIBRARY) concat '/'",
            'concat trim(aj.JOB_DESCRIPTION) as "JOBD",',
            "trim(aj.OUTPUT_QUEUE_LIBRARY) concat '/'",
            'concat trim(aj.OUTPUT_QUEUE) as "OUTQ", ',
            'aj.OPEN_FILES,',
            'aj."CCSID",',
            'aj.DEFAULT_CCSID as "Default CCSID",',
            'aj.JOB_TYPE_ENHANCED,',
            ' MEMORY_POOL, TEMPORARY_STORAGE, CPU_TIME, TOTAL_DISK_IO_COUNT as "Total Disk I/O"',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(SUBSYSTEM_LIST_FILTER => '${userSBSList}')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        environment: 'cmdEntryPool',
        order: 10,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-custom-detailed',
        label: 'Active Jobs Detailed',
        description: 'sbs(${userSBSList})',
        stmt: [
            'SELECT aj.JOB_NAME as JOB, aj.SUBSYSTEM, aj.JOB_NAME_SHORT as JOB_NAME,',
            'aj.AUTHORIZATION_NAME as USER_NAME, ',
            'JOB_TYPE,JOB_STATUS,',
            ' MEMORY_POOL, TEMPORARY_STORAGE as "Temp Stg", CPU_TIME, TOTAL_DISK_IO_COUNT as "Total Disk I/O"',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'ALL', SUBSYSTEM_LIST_FILTER => '${userSBSList}')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        environment: 'cmdEntryPool',
        order: 20,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-qinter',
        label: 'Active Jobs',
        description: 'sbs(${sbsId})',
        variables: [
            { var: 'sbsId', value: 'QINTER' }
        ],
        stmt: [
            'SELECT aj.JOB_NAME as JOB, aj.SUBSYSTEM, aj.JOB_NAME_SHORT as JOB_NAME,',
            'aj.AUTHORIZATION_NAME as USER_NAME, ',
            'JOB_TYPE,JOB_STATUS,',
            " trim(aj.FUNCTION_TYPE) concat '-' concat aj.FUNCTION as FUNCTION_INFO,",
            'aj.JOB_ACTIVE_TIME as "Job Start Time",',
            'aj.CLIENT_IP_ADDRESS,',
            "trim(aj.JOB_DESCRIPTION_LIBRARY) concat '/'",
            'concat trim(aj.JOB_DESCRIPTION) as "JOBD",',
            "trim(aj.OUTPUT_QUEUE_LIBRARY) concat '/'",
            'concat trim(aj.OUTPUT_QUEUE) as "OUTQ", ',
            'aj.OPEN_FILES,',
            'aj."CCSID",',
            'aj.DEFAULT_CCSID as "Default CCSID",',
            'aj.JOB_TYPE_ENHANCED,',
            ' MEMORY_POOL, TEMPORARY_STORAGE as "Temp Stg", CPU_TIME, TOTAL_DISK_IO_COUNT as "Total Disk I/O"',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'ALL', SUBSYSTEM_LIST_FILTER => '${sbsId}')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        environment: 'cmdEntryPool',
        singleRowResultView: 'row',
        order: 30,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-qbatch',
        label: 'Active Jobs',
        description: 'sbs(${sbsId})',
        variables: [
            { var: 'sbsId', value: 'QBATCH' }
        ],
        stmt: [
            'SELECT aj.JOB_NAME as JOB, aj.SUBSYSTEM, aj.JOB_NAME_SHORT as JOB_NAME,',
            'aj.AUTHORIZATION_NAME as USER_NAME, ',
            'JOB_TYPE,JOB_STATUS,',
            " trim(aj.FUNCTION_TYPE) concat '-' concat aj.FUNCTION as FUNCTION_INFO,",
            'aj.JOB_ACTIVE_TIME as "Job Start Time",',
            'aj.CLIENT_IP_ADDRESS,',
            "trim(aj.JOB_DESCRIPTION_LIBRARY) concat '/'",
            'concat trim(aj.JOB_DESCRIPTION) as "JOBD",',
            "trim(aj.OUTPUT_QUEUE_LIBRARY) concat '/'",
            'concat trim(aj.OUTPUT_QUEUE) as "OUTQ", ',
            'aj.OPEN_FILES,',
            'aj."CCSID",',
            'aj.DEFAULT_CCSID as "Default CCSID",',
            'aj.JOB_TYPE_ENHANCED,',
            ' MEMORY_POOL, TEMPORARY_STORAGE as "Temp Stg", CPU_TIME, TOTAL_DISK_IO_COUNT as "Total Disk I/O"',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'ALL', SUBSYSTEM_LIST_FILTER => '${sbsId}')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        environment: 'cmdEntryPool',
        singleRowResultView: 'row',
        order: 40,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-qusrwrk',
        label: 'Active Jobs',
        description: 'sbs(${sbsId})',
        variables: [
            { var: 'sbsId', value: 'QUSRWRK' }
        ],
        stmt: [
            'SELECT aj.JOB_NAME as JOB, aj.SUBSYSTEM, aj.JOB_NAME_SHORT as JOB_NAME,',
            'aj.AUTHORIZATION_NAME as USER_NAME, ',
            'JOB_TYPE,JOB_STATUS,',
            " trim(aj.FUNCTION_TYPE) concat '-' concat aj.FUNCTION as FUNCTION_INFO,",
            'aj.JOB_ACTIVE_TIME as "Job Start Time",',
            'aj.CLIENT_IP_ADDRESS,',
            "trim(aj.JOB_DESCRIPTION_LIBRARY) concat '/'",
            'concat trim(aj.JOB_DESCRIPTION) as "JOBD",',
            "trim(aj.OUTPUT_QUEUE_LIBRARY) concat '/'",
            'concat trim(aj.OUTPUT_QUEUE) as "OUTQ", ',
            'aj.OPEN_FILES,',
            'aj."CCSID",',
            'aj.DEFAULT_CCSID as "Default CCSID",',
            'aj.JOB_TYPE_ENHANCED,',
            ' MEMORY_POOL, TEMPORARY_STORAGE as "Temp Stg", CPU_TIME, TOTAL_DISK_IO_COUNT as "Total Disk I/O"',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'ALL', SUBSYSTEM_LIST_FILTER => '${sbsId}')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        environment: 'cmdEntryPool',
        singleRowResultView: 'row',
        order: 40,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-qhttpsvr',
        label: 'Active Jobs',
        description: 'sbs(${sbsId})',
        variables: [
            { var: 'sbsId', value: 'QHTTPSVR' }
        ],
        stmt: [
            'SELECT aj.JOB_NAME as JOB, aj.SUBSYSTEM, aj.JOB_NAME_SHORT as JOB_NAME,',
            'aj.AUTHORIZATION_NAME as USER_NAME, ',
            'JOB_TYPE,JOB_STATUS,',
            " trim(aj.FUNCTION_TYPE) concat '-' concat aj.FUNCTION as FUNCTION_INFO,",
            'aj.JOB_ACTIVE_TIME as "Job Start Time",',
            'aj.CLIENT_IP_ADDRESS,',
            "trim(aj.JOB_DESCRIPTION_LIBRARY) concat '/'",
            'concat trim(aj.JOB_DESCRIPTION) as "JOBD",',
            "trim(aj.OUTPUT_QUEUE_LIBRARY) concat '/'",
            'concat trim(aj.OUTPUT_QUEUE) as "OUTQ", ',
            'aj.OPEN_FILES,',
            'aj."CCSID",',
            'aj.DEFAULT_CCSID as "Default CCSID",',
            'aj.JOB_TYPE_ENHANCED,',
            ' MEMORY_POOL, TEMPORARY_STORAGE as "Temp Stg", CPU_TIME, TOTAL_DISK_IO_COUNT as "Total Disk I/O"',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'ALL', SUBSYSTEM_LIST_FILTER => '${sbsId}')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        environment: 'cmdEntryPool',
        singleRowResultView: 'row',
        order: 50,
        source: 'built-in'
    },
    {
        id: 'builtin.QSYSOPR',
        label: 'QSYSOPR messages',
        description: '(descend)',
        stmt: [
            'SELECT message_ID,',
            "CASE UPPER(TRIM(MESSAGE_TYPE))",
            "WHEN 'COMMAND' THEN '*CMD'",
            "WHEN 'COMPLETION' THEN '*COMP'",
            "WHEN 'DIAGNOSTIC' THEN '*DIAG'",
            "WHEN 'ESCAPE' THEN '*ESCAPE'",
            "WHEN 'INFORMATIONAL' THEN '*INFO'",
            "WHEN 'INQUIRY' THEN '*INQ'",
            "WHEN 'NOTIFY' THEN '*NOTIFY'",
            "WHEN 'REPLY' THEN '*RPY'",
            "WHEN 'REQUEST' THEN '*RQS'",
            "WHEN 'SCOPE' THEN '*SCOPE'",
            "WHEN 'SENDER' THEN '*SENDER'",
            "ELSE MESSAGE_TYPE",
            "END AS MSGTYPE,",
            "Message_text AS MSGTEXT,",
            "SEVERITY AS SEV,",
            "MESSAGE_TIMESTAMP,",
            "FROM_USER,FROM_JOB,FROM_PROGRAM,",
            "COALESCE(TRIM(MESSAGE_FILE_LIBRARY) CONCAT '/', '') CONCAT",
            "message_file_name AS MSGFILE,",
            "MESSAGE_SECOND_LEVEL_TEXT AS MSG_2ND_LEVEL",
            "FROM TABLE (qsys2.message_queue_info(QUEUE_NAME=>'QSYSOPR'))",
            'order by MESSAGE_TIMESTAMP desc'
        ].join(' '),
        group: 'Admin',
        environment: 'cmdEntryPool',
        singleRowResultView: 'row',
        order: 60,
        source: 'built-in'
    },


    {
        id: 'builtin.spooled-files-user',
        label: 'SPOOLED Files List',
        description: '${currentUser}',
        title: 'SPOOLED Files User(${currentUser})',
        stmt: [
            'SELECT SPOOLED_FILE_NAME AS SPLFNAME,',
            'SPOOLED_FILE_NUMBER AS SPLNBR,',
            'QUALIFIED_JOB_NAME as "Created in Job",',
            'STATUS,TOTAL_PAGES AS PAGES,USER_DATA,FORM_TYPE,',
            'JOB_USER AS USER_NAME,',
            "TRIM(OUTPUT_QUEUE_LIBRARY) CONCAT '/' CONCAT OUTPUT_QUEUE AS OUTPUT_QUEUE,",
            'OUTPUT_PRIORITY AS OUTPTY,',
            'COPIES,SIZE,',
            'CREATION_TIMESTAMP AS CREATED,',
            'FILE_AVAILABLE AS FILE_AVAIL,',
            'ASP_NUMBER,SYSTEM AS "System Where Created",',
            "'Select ordinal_position as SPLRECNBR, SPOOLED_DATA from table(systools.SPOOLED_FILE_DATA('''",
            " CONCAT QUALIFIED_JOB_NAME CONCAT",
            "''',''' CONCAT TRIM(spooled_file_name) CONCAT ''',' CONCAT spooled_file_number CONCAT ')) DSPSPLF",
            "ORDER BY ORDINAL_POSITION'",
            'AS DSPSPLF_via_SQL',
            "FROM TABLE(QSYS2.SPOOLED_FILE_INFO(USER_NAME => '${currentUser}'))",
            " WHERE SPOOLED_FILE_NAME <> 'QPRINT' AND JOB_NAME <> 'MAPEPIRE'",
            " ORDER BY CREATION_TIMESTAMP"
        ].join(' '),
        group: 'SPOOLED Files',
        environment: 'cmdEntryPool',
        singleRowResultView: 'row',
        order: 10,
        source: 'built-in'
    },
    {
        id: 'builtin.last-user-spooled-file',
        label: 'View Last SPOOLED File',
        description: '${currentUser}',
        title: 'Last SPOOLED File for User(${currentUser})',
        stmt: [
            'WITH sf AS (',
            'SELECT * FROM TABLE (qsys2.spooled_file_info(',
            "     USER_NAME => '*CURRENT', job_name => '*ALL')) SF",
            '  ORDER BY sf.creation_timestamp DESC',
            '  LIMIT 1',
            ') ',
            'SELECT SF.CREATION_TIMESTAMP AS CREATED,',
            ' SF.QUALIFIED_JOB_NAME as "Created in Job",',
            ' sf.SPOOLED_FILE_NAME as SPLFNAME, ',
            ' sd.SPOOLED_DATA FROM sf',
            ',LATERAL (SELECT * FROM TABLE(systools.spooled_file_data(',
            '           JOB_NAME => SF.QUALIFIED_JOB_NAME,',
            '           SPOOLED_FILE_NAME => SF.SPOOLED_FILE_NAME,',
            '           SPOOLED_FILE_NUMBER => SF.SPOOLED_FILE_NUMBER)) spd) sd'
        ].join(' '),
        group: 'SPOOLED Files',
        environment: 'cmdEntryPool',
        singleRowResultView: 'row',
        order: 20,
        source: 'built-in'
    }
];
