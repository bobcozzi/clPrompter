/**
 * Generates SQL DDL for the UDTF from embedded source SQL.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/JOB_LIBL/JOB_LIBL.SQL
 */
import { applySqlSourceTokens } from '../sqlSourceTokens';

const SQL_TEMPLATE = String.raw`

    -- Retrieve Job Attributes

CREATE or REPLACE FUNCTION sqltools.job_libl(
           JOB          varchar(28) default '*',
           PORTION      varchar(10) default '*ALL'
                                  )
       RETURNS table (

          ORDINAL_POSITION int,  -- Sequence of library on library list
          LIBRARY_NAME      VARCHAR(10),  -- Library Name
              -- Library List Portion (i.e., SYSTEM, PRODUCT, CURRENT, USER)
          TYPE              VARCHAR(10),
              -- Library Type (i.e., *PROD, *TEST)
          LIBRARY_TYPE      VARCHAR(5),
          LIBRARY_TEXT      VARCHAR(50),
          IASP_NUMBER       smallint,
          IASP_NAME         VARCHAR(10),
          IASP_GROUP        VARCHAR(10),
          OBJECT_COUNT      INT,
              -- Same as TYPE
          PORITION          VARCHAR(10),
              -- Qualified 3-part job name of job whose library_List is returned
          Job               VARCHAR(28)

       )
    LANGUAGE RPGLE
    NO SQL
    NOT DETERMINISTIC
    NOT FENCED
    CALLED ON NULL INPUT
    DISALLOW PARALLEL
    SCRATCHPAD 256
    SPECIFIC sqlTools.JOB_LIBL
    EXTERNAL NAME 'SQLTOOLS/JOB_LIBL'
    PARAMETER STYLE DB2SQL;


LABEL on specific routine sqltools.job_libl IS
'\${version} Library list for the specified job';

comment on specific function sqltools.job_libl IS
'\${version} Library list for the specified job
retrieves the libary list for the specified job or the current job
when no JOB parameter is specified. The library name, the portion of
the library list where the library occurs along with the library object''s
Text description and Type (*PROD or *TEST) are returned.
The iASP name, number and group of the library is also included.';

comment on parameter specific function sqltools.job_libl
( JOB is 'The fully qualified job name whose library list is returned.
 The default * returns the library list for the job running the UDTF.
 The job name must be in the <i>nnnnnn/userid/jobname</i> format.',

 PORTION is 'The section of the library list to be returned. The default is
 *ALL if unspecified. You may limit what is returned to just one section,
 such as *PROD, *CURRENT, *USER, *SYSTEM portions. In addition, the
 special value *ALL returns all libraries on the library list, and
 *ALLUSR (or *ALLUSER) returns the PRODUCT, CURRENT, and USER portions
 of the library list, that is it omits the SYSTEM Portion libraries.
 Note the library list portion attribute is returned in the "TYPE"
 column to match the IBM SQL VIEW that does a similar task but
 does not permit a job name for input. We have a 2nd "TYPE" column
 included in this UDTF named PORTION that contains an abbreviated
 form of the portion identification; one that matches the DSPLIBL
 results. Therefore: SYS, PRD, CUR, and USR are returned.'
);
`;

export function getJobLiblSQLSrc(library: string, version: number): string {
    return applySqlSourceTokens(SQL_TEMPLATE, library, version);
}
