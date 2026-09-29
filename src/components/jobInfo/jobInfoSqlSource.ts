/**
 * Generates the SQL DDL used to create (or replace) the JOB_INFO UDTF in the
 * target library on IBM i.
 */
export function getJobInfoSQLSrc(library: string, version: number): string {
    return `
CREATE OR REPLACE FUNCTION ${library}.JOB_INFO(
               JOB_NAME     VARCHAR(28) DEFAULT '*'
                                            )
       RETURNS TABLE (
          JOB                 VARCHAR(28),
          JOB_NAME            VARCHAR(10),
          JOB_USER            VARCHAR(10),
          JOB_NBR             VARCHAR(6),
          JOB_DATE            DATE,
          JOB_STATUS          VARCHAR(10),

          JOB_TYPE            VARCHAR(1),
          JOB_SUBTYPE         VARCHAR(1),
          SUBSYSTEM_NAME      VARCHAR(10),
          LAST_FUNCTION       VARCHAR(14),
          ACTIVE_JOB_STATUS   VARCHAR(4),
          RUNPTY              INT,
          POOL_NAME           VARCHAR(10),
          POOL_ID             INT,
          REPLY               VARCHAR(1),
          MSGKEY_HEX          VARCHAR(8),
          MSGKEY              BINARY(4),
          MSGQ_NAME           VARCHAR(10),
          MSGQ_LIB            VARCHAR(10),
          MSGQ_LIB_ASP        VARCHAR(10),
          OUTQ_NAME           VARCHAR(10),
          OUTQ_LIB            VARCHAR(10),
          OUTQ_PTY            VARCHAR(2),
          PRTDEV_NAME         VARCHAR(10)

       )
  LANGUAGE RPGLE
  NO SQL
  NO FINAL CALL
  SCRATCHPAD 128
  DISALLOW PARALLEL
  CARDINALITY 1
  EXTERNAL NAME '${library}/JOB_INFO'
  SPECIFIC ${library}.job_info
  PARAMETER STYLE DB2SQL;

LABEL ON SPECIFIC ROUTINE ${library}.job_info IS
'${version} Job Status Info';

COMMENT ON SPECIFIC FUNCTION ${library}.job_info IS
'${version} Job Status Info';

COMMENT ON PARAMETER SPECIFIC FUNCTION ${library}.job_info
( JOB_NAME IS 'The fully qualified 3-part job name whose job
attributes are returned.' );
`;
}
