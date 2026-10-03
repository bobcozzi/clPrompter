/**
 * Generates SQL DDL for the UDTF from embedded source SQL.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/JOB_ATTR/JOB_ATTR.SQL
 */
import { applySqlSourceTokens } from '../sqlSourceTokens';

const SQL_TEMPLATE = String.raw`
 -- SPDX-License-Identifier: Apache-2.0
 -- Copyright (c) 1996-2026 by R. Cozzi, Jr.
 -- @author BobCozzi

-- Retrieve Job information (status, msgq, outq)
--
-- Source origin:
--        /Users/cozzi/Downloads/projects/open-UDTF/src/JOB_INFO/JOB_INFO

CREATE or REPLACE FUNCTION SQLTOOLS.JOB_ATTR(
               JOB_NAME     varchar(28) default '*'
                                            )
       RETURNS table (
          Job         varchar(28),
          Job_Name    varchar(10),
          Job_User    varchar(10),
          Job_Nbr     varchar(6),
          Job_Date    date,
          Job_Status  varchar(10),

          Job_Type    varchar(1),
          Job_Subtype varchar(1),
          Subsystem_Name VARCHAR(10),
          Last_Function VARCHAR(14),
          Active_Job_Status VARCHAR(4),
          RunPTY INT,
          Pool_Name VARCHAR(10),
          Pool_ID INT,
          Reply VARCHAR(1),
          MSGKEY_Hex VARCHAR(8),
          MSGKEY BINARY(4),
          MSGQ_NAME VARCHAR(10),
          MSGQ_Lib VARCHAR(10),
          MSGQ_Lib_ASP VARCHAR(10),
          Outq_Name VARCHAR(10),
          Outq_Lib VARCHAR(10),
          Outq_Pty VARCHAR(2),
          PrtDev_Name VARCHAR(10)

       )
  LANGUAGE RPGLE
  NO SQL
  NO FINAL CALL
  SCRATCHPAD 128
  DISALLOW PARALLEL
  CARDINALITY 1
  EXTERNAL NAME 'SQLTOOLS/JOB_ATTR'
  SPECIFIC sqlTools.job_attr
  PARAMETER STYLE DB2SQL;

LABEL on specific routine sqltools.job_attr IS
'\${version} Job Status Info';

comment on specific function sqltools.job_attr IS
'\${version} Job Status Info. This is used to return the current job status
When the job status is MSGW (message wait) then the MSGKEY and MSGQ columns
may be used to identify the message and message queue where a message-reply
should be sent using interfaces such as the SNDRPY CL command.';

comment on parameter specific function sqltools.job_attr
( JOB_NAME is 'The fully qualified 3-part job name whose job
information is to be returned. If unspecified, the default ''*'' is used
and causes the information for the job running this UDTF to be returned.');
`;

export function getJobAttrSQLSrc(library: string, version: number): string {
    return applySqlSourceTokens(SQL_TEMPLATE, library, version);
}
