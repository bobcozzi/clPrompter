/**
 * Generates SQL DDL for the UDTF from embedded source SQL.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/LAST_SPLF/LAST_SPLF.SQL
 */
const SQL_TEMPLATE = String.raw`

CREATE or REPLACE FUNCTION sqltools.LAST_SPLF(
             -- Scope Options:
                --   JOB  Last SPOOLED file for the Job (default)
                --   USER Last SPOOLED file for the user
                             SCOPE VARCHAR(10) DEFAULT 'JOB'
                                             )
       RETURNS table (
          splfName  varchar(10),   -- SPOOLED File Name
          splnbr    int,           -- SPOOLED File Number
          job       varchar(28),   -- 3-part Job ID
          jobName   varchar(10),   -- Job name
          jobUser   varchar(10),   -- Job User
          jobNbr    varchar(6),    -- Job Number
          sysname   varchar(8),    -- Partition ID where created
          CREATION_TIMESTAMP TIMESTAMP(0) -- Creation timestamp

)   LANGUAGE C++
     NO SQL
     NOT DETERMINISTIC
     NOT FENCED
     NO FINAL CALL
     DISALLOW PARALLEL
     CARDINALITY 1
     SCRATCHPAD 255
     SPECIFIC sqlTools.LAST_SPLF
     EXTERNAL NAME 'SQLTOOLS/LAST_SPLF'
     PARAMETER STYLE DB2SQL;

LABEL on specific routine SQLTOOLS.LAST_SPLF IS
'\${version} Last SPOOLED File for the User or Job';

comment on SPECIFIC FUNCTION SQLTOOLS.LAST_SPLF is
'\${version} Last SPOOLED File for the User or Job
 The LAST_SPLF UDTFSPOOLED File Identity (RTVLASTSPLF) UDTF.
 The LAST_SPLF UDTF returns the identity of the most recently created
 SPOOLED file for the job in which the function is running.  The SCOPE
 parameter may be JOB (the default) or USER. When USER is specified, then
 the last SPOOLED file created on the system for the specified User Profile
 is returned.';

comment on parameter SPECIFIC Function SQLTOOLS.LAST_SPLF (
  SCOPE is 'Controls how the last SPOOLED File identity is located.
The valid choices are:
<ul><li><u>*JOB</u> - Last SPOOLED File created in "this" Job</li>
<li>*USER - Last SPOOLED File the User created</li></ul>
<p>*JOB (the default) returns faster than *USER.</p>
<p>The leading asterisk and upper/lower case are ignored.</p>'
);

`;

export function getLastSplfSQLSrc(library: string, version: number): string {
  return SQL_TEMPLATE
    .replace(/\\\$\{version\}/gi, String(version))
    .replace(/\$\{version\}/gi, String(version))
    .replace(/sqltools\./gi, `${library}.`)
    .replace(/SQLTOOLS\//g, `${library}/`);
}
