export interface CommandEntrySqlSnippet {
    id: string;
    label: string;
    stmt: string;
    group: string;
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
        order: 10,
        source: 'built-in'
    },
    {
        id: 'builtin.full-joblog',
        label: 'Joblog (full)',
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
        order: 20,
        source: 'built-in'
    },
    {
        id: 'builtin.job-attributes',
        label: 'Job Attributes',
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
        order: 30,
        source: 'built-in'

    },
    {
        id: 'builtin.library-list',
        label: 'Library List',
        stmt: [
            'SELECT ORDINAL_POSITION AS "Sequence",',
            'SYSTEM_SCHEMA_NAME as "Library Name",',
            '"TYPE" AS "LIBL Type",',
            "'*' CONCAT ld.library_type AS ", '"Library Type",',
            'ld.object_count,ll.TEXT_DESCRIPTION AS "Text",',
            'll.IASP_NUMBER AS "IASP Number",',
            'ld.IASP_NAME AS "iASP Name",',
            'SCHEMA_NAME AS "Library Long Name"',
            'FROM QSYS2.LIBRARY_LIST_INFO LL ',
            ', LATERAL (SELECT * FROM TABLE (LIBRARY_INFO(LL.SYSTEM_SCHEMA_NAME,',
            "DETAILED_INFO => 'NO')) LibInfo ) LD"
        ].join(' '),
        group: 'Job Info',
        order: 40,
        source: 'built-in'
    },
    {
        id: 'builtin.job-splf-list',
        label: 'SPOOLED Files List (Job)',
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
            "''',''' CONCAT TRIM(spooled_file_name) CONCAT ''',' CONCAT spooled_file_number CONCAT ')) DSPSPLF'",
            'AS DSPSPLF_via_SQL',
            "FROM TABLE(QSYS2.SPOOLED_FILE_INFO(JOB_NAME => '${sqlJobId}' ))",
            "WHERE (SPOOLED_FILE_NAME <> 'QPRINT' AND JOB_NAME <> 'MAPEPIRE')",
            'ORDER BY CREATION_TIMESTAMP'
        ].join(' '),
        group: 'Job Info',
        order: 90,
        source: 'built-in'
    },
    {
        id: 'builtin.last-job-spooled-file',
        label: 'View Last SPOOLED File (Job)',
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
        order: 100,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-settings',
        label: 'Active Jobs (User/Fast)',
        stmt: [
            'SELECT aj.JOB_NAME as JOB, aj.SUBSYSTEM, aj.JOB_NAME_SHORT as JOB_NAME,',
            'aj.AUTHORIZATION_NAME as USER_NAME, ',
            " trim(aj.FUNCTION_TYPE) concat '-' concat aj.FUNCTION as FUNCTION_INFO,",
            ' JOB_STATUS, ',
            ' MEMORY_POOL, TEMPORARY_STORAGE, CPU_TIME, TOTAL_DISK_IO_COUNT as "Total Disk I/O"',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(SUBSYSTEM_LIST_FILTER => '${userSBSList}')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        order: 10,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-settings-detailed',
        label: 'Active Jobs (User/Detailed)',
        stmt: [
            'SELECT aj.JOB_NAME as JOB, aj.SUBSYSTEM, aj.JOB_NAME_SHORT as JOB_NAME,',
            'aj.AUTHORIZATION_NAME as USER_NAME, ',
            " trim(aj.FUNCTION_TYPE) concat '-' concat aj.FUNCTION as FUNCTION_INFO,",
            ' JOB_STATUS, JOB_ACTIVE_TIME as "Job Start Time",',
            ' MEMORY_POOL, TEMPORARY_STORAGE as "Temp Stg", CPU_TIME, TOTAL_DISK_IO_COUNT as "Total Disk I/O"',
            ' , OUTPUT_QUEUE, JOB_USER_IDENTITY, PAGE_FAULTS, DATABASE_LOCK_WAITS, OPEN_FILES',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'ALL', SUBSYSTEM_LIST_FILTER => '${userSBSList}')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        order: 20,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-qinter',
        label: 'Active Jobs sbs(QINTER)',
        stmt: [
            'SELECT aj.JOB_NAME as JOB, aj.SUBSYSTEM, aj.JOB_NAME_SHORT as JOB_NAME,',
            'aj.AUTHORIZATION_NAME as USER_NAME, ',
            " trim(aj.FUNCTION_TYPE) concat '-' concat aj.FUNCTION as FUNCTION_INFO,",
            ' JOB_STATUS, JOB_ACTIVE_TIME as "Job Start Time",',
            ' MEMORY_POOL, TEMPORARY_STORAGE as "Temp Stg", CPU_TIME, TOTAL_DISK_IO_COUNT as "Total Disk I/O"',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'ALL', SUBSYSTEM_LIST_FILTER => 'QINTER')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        order: 30,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-qbatch',
        label: 'Active Jobs sbs(QBATCH)',
        stmt: [
            'SELECT aj.JOB_NAME as JOB, aj.SUBSYSTEM, aj.JOB_NAME_SHORT as JOB_NAME,',
            'aj.AUTHORIZATION_NAME as USER_NAME, ',
            " trim(aj.FUNCTION_TYPE) concat '-' concat aj.FUNCTION as FUNCTION_INFO,",
            ' JOB_STATUS, JOB_ACTIVE_TIME as "Job Start Time",',
            ' MEMORY_POOL, TEMPORARY_STORAGE as "Temp Stg", CPU_TIME, TOTAL_DISK_IO_COUNT as "Total Disk I/O"',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'ALL', SUBSYSTEM_LIST_FILTER => 'QBATCH')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        order: 40,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-qusrwrk',
        label: 'Active Jobs sbs(QUSRWRK)',
        stmt: [
            'SELECT aj.JOB_NAME as JOB, aj.SUBSYSTEM, aj.JOB_NAME_SHORT as JOB_NAME,',
            'aj.AUTHORIZATION_NAME as USER_NAME, ',
            " trim(aj.FUNCTION_TYPE) concat '-' concat aj.FUNCTION as FUNCTION_INFO,",
            ' JOB_STATUS, JOB_ACTIVE_TIME as "Job Start Time",',
            ' MEMORY_POOL, TEMPORARY_STORAGE as "Temp Stg", CPU_TIME, TOTAL_DISK_IO_COUNT as "Total Disk I/O"',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'ALL', SUBSYSTEM_LIST_FILTER => 'QUSRWRK')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        order: 40,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-qhttpsvr',
        label: 'Active Jobs sbs(QHTTPSVR)',
        stmt: [
            'SELECT aj.JOB_NAME as JOB, aj.SUBSYSTEM, aj.JOB_NAME_SHORT as JOB_NAME,',
            'aj.AUTHORIZATION_NAME as USER_NAME, ',
            " trim(aj.FUNCTION_TYPE) concat '-' concat aj.FUNCTION as FUNCTION_INFO,",
            ' JOB_STATUS, JOB_ACTIVE_TIME as "Job Start Time",',
            ' MEMORY_POOL, TEMPORARY_STORAGE as "Temp Stg", CPU_TIME, TOTAL_DISK_IO_COUNT as "Total Disk I/O"',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'ALL', SUBSYSTEM_LIST_FILTER => 'QHTTPSVR')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        order: 50,
        source: 'built-in'
    },
    {
        id: 'builtin.spooled-files-user',
        label: 'SPOOLED Files List (User)',
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
            "''',''' CONCAT TRIM(spooled_file_name) CONCAT ''',' CONCAT spooled_file_number CONCAT ')) DSPSPLF'",
            'AS DSPSPLF_via_SQL',
            "FROM TABLE(QSYS2.SPOOLED_FILE_INFO(USER_NAME => '${currentUser}'))",
            " WHERE SPOOLED_FILE_NAME <> 'QPRINT' AND JOB_NAME <> 'MAPEPIRE'",
            " ORDER BY CREATION_TIMESTAMP"
        ].join(' '),
        group: 'SPOOLED Files',
        order: 10,
        source: 'built-in'
    },
    {
        id: 'builtin.last-user-spooled-file',
        label: 'View Last SPOOLED File (User)',
        stmt: [
            'WITH sf AS (',
            'SELECT * FROM TABLE (qsys2.spooled_file_info(',
            "     USER_NAME => '*CURRENT', job_name => '*ALL')) SF",
            '  ORDER BY sf.creation_timestamp DESC',
            '  LIMIT 1',
            ') ',
            'SELECT SF.CREATION_TIMESTAMP AS CREATED,',
            ' SF.QUALIFIED_JOB_NAME as JOB, sf.SPOOLED_FILE_NAME as SPLFNAME,',
            ' sd.SPOOLED_DATA FROM sf',
            ',LATERAL (SELECT * FROM TABLE(systools.spooled_file_data(',
            '           JOB_NAME => SF.QUALIFIED_JOB_NAME,',
            '           SPOOLED_FILE_NAME => SF.SPOOLED_FILE_NAME,',
            '           SPOOLED_FILE_NUMBER => SF.SPOOLED_FILE_NUMBER)) spd) sd'
        ].join(' '),
        group: 'SPOOLED Files',
        order: 20,
        source: 'built-in'
    }
];
