/**
 * Embedded source for JOB_LIBL.RPGLE.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/JOB_LIBL/JOB_LIBL.RPGLE
 * Stored as plain text (no base64 encoding).
 */
export function getJobLiblRPGLESrc(): string {
     return String.raw`
**free

// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 by R. Cozzi, Jr.


  // @author BobCozzi

    ////////////////////////////////////////////////////////////////////////
    // IBM i Retrieve Job Library List UDTF
    // This is an SQL UDTF External Program
    // It uses the QUSRJOBI API to retreive a Job's Library List
    // This information is currently not available via QSYS2 SQL functions
    ////////////////////////////////////////////////////////////////////////
    // This is part of the collection of open source SQL UDTFs that are
    // primarily built for the VS CODE and CODE for IBM i IDE, however
    // they can certainly be feely used in production environments on IBM i
    // Available on github at:  https://github.com/bobcozzi/open-UDTF
    ////////////////////////////////////////////////////////////////////////

ctl-opt   main(main) OPTION(*SRCSTMT);

      /if defined(*CRTBNDRPG)
          ctl-opt DFTACTGRP(*NO) ACTGRP(*CALLER);
      /endif

          // Use the PSDS to obtain "this" Program's name
     dcl-ds psds psds qualified;
       pgmname *proc;
     end-ds;

          // SQL UDF Stuff
     dcl-c SQL_FETCH 0;
     dcl-c SQL_OPEN -1;
     dcl-c SQL_CLOSE 1;

          // Standardized API exception/error struct for APIs
     dcl-ds QUSEC_t Qualified Template;
          bytes_Provided  int(10) inz(%size(QUSEC_T));
          bytes_Available INT(10);
          bytes_RTN       int(10) overlay(bytes_available);
          bytes_returned  int(10) overlay(bytes_available);
          bytesReturned   int(10) overlay(bytes_available);
          exception_Id    char(7);
          msgid           char(7) overlay(exception_id);
          reserved        char(1);
          msgdata         char(64);
     end-ds;
          // 3-Part job struct for API calls
     dcl-ds JOBID_T Qualified Template;
          JOB_NAME char(10);
          JOB_USER char(10);
          JOB_NBR char(6);
     end-ds;
          // Retrieve Job Attributes
     dcl-pr QUSRJOBI EXTPGM('QUSRJOBI');
          rtnJobInfo char(6000) OPTIONS(*VARSIZE);
          rtnJobInfoSize int(10) Const;
          APIFORMAT  char(8) Const;
          JobID      char(26) Const;
          InternalJobID char(16) Const;
          apiError  LikeDS(QUSEC_T) OPTIONS(*VARSIZE);
     end-pr QUSRJOBI;
          // Get pointer to existing User Space
     dcl-pr QUSPTRUS  extPgm('QUSPTRUS');
       userSpace char(20) Const;
       pRtnPtrVar pointer;
       api_error  LikeDS(QUSEC_T) OPTIONS(*VARSIZE:*NOPASS);
     end-pr;
          // Delete User Space
     dcl-pr QusDltUS  extPgm('QUSDLTUS');
        userSpace char(20) Const;
        api_error  LikeDS(QUSEC_T) OPTIONS(*VARSIZE:*NOPASS);
     end-pr;
          // Delete Object (use when RMVMSG is desired)
     dcl-pr QLIDLTO  extPgm('QLIDLTO');
         objectName char(20) Const;
         objType    char(10) Const;
         ASP_NAME   char(10) Const;  // Use '*'
         rmvMsg     char(1)  Const;  // '1'=remove "User Space deleted" msg
         api_error  LikeDS(QUSEC_T) OPTIONS(*VARSIZE:*NOPASS);
     end-pr;

          // Convert to hex from char MI inst.
     dcl-pr cvthc  extProc('cvthc');
          outHexVal  char(65534) OPTIONS(*VARSIZE);
          inCharVal char(32766) OPTIONS(*VARSIZE)  CONST;
          hexLen int(10) Value;
     end-pr;
          // Convert to char from hex MI inst.
     dcl-pr cvtch  extProc('cvtch');
          outCharVal char(32766) OPTIONS(*VARSIZE);
          inHexVal  char(65534) OPTIONS(*VARSIZE) CONST;
          hexLen int(10) Value;
     end-pr;

          // Library List Library Info returned by QLIRLIBD API
     dcl-ds library_Info qualified inz;
          lib_type       CHAR(5);
          iASP_Nbr       INT(10);
          iASP_Name      VARCHAR(10);
          iASP_Group     VARCHAR(10);
          Lib_Text       VARCHAR(50);
          OBJ_COUNT      INT(10);
     end-ds;
          // Library List info return from QUSRJOBI
     dcl-ds Qwc_JOBI0750_T  Qualified Inz TEMPLATE;
          Bytes_Return INT(10);
          Bytes_Avail INT(10);
          Job_Name CHAR(10);
          User_Name CHAR(10);
          Job_Number CHAR(6);
          Int_Job_ID CHAR(16);
          Job_Status CHAR(10);
          Job_Type CHAR(1);
          Job_Subtype CHAR(1);
          Reserved CHAR(2);
          Offset_Sys_Libs INT(10);
          Number_Sys_Libs INT(10);
          Offset_Prod_Libs INT(10);
          Number_Prod_Libs INT(10);
          Offset_Curr_Libs INT(10);
          Number_Curr_Libs INT(10);
          Offset_User_Libs INT(10);
          Number_User_Libs INT(10);
          Lng_One_Lib_Entry INT(10);
          // Qwc_Lib_List2_T dim(n) - A list of library info entries
     end-ds;  // Qwc_JOBI0750_T

          // Struct of each library returned by format JOBI0750
     dcl-ds Qwc_Lib_List2_T  Qualified Inz TEMPLATE;
          Lib_Name  CHAR(10);
          Lib_Text  CHAR(50);
          iASP_Nbr  INT(10);
          iASP_Name CHAR(10);
     end-ds;  // Qwc_Lib_List2_T

          // SQL UDTF Scratch pad passed to this program
          // Note all Scratch pads have their defined length
          // as the first entry (first 4-byte int)
     dcl-ds scratch_t Qualified Template;
       length int(10);  // Length of this scratch pad
       eof    int(10);  // 1=EOF in list has been reached
       jobID  likeds(jobid_t);  // Saved 3-part job ID
       LIBL_US CHAR(20);  // Name of the User space for library list info
       COUNTER  int(10);  // Counter of rows returned so far
       LIBLSIZE int(10);  // Number of Libraries on LIBL
       SYSLIBS  int(10);  // Number of System Portion Libraries
       PRDLIBS  int(10);  // Number of Product Libraries (0, 1, or 2)
       CURLIBS  int(10);  // Number of Current Libraries (0 or 1)
       USRLIBS  int(10);  // Number of User Portion Libraries
       SYSLIBS_COUNTER  int(10);
       PRDLIBS_COUNTER  int(10);
       CURLIBS_COUNTER  int(10);
       USRLIBS_COUNTER  int(10);
     end-ds;
     dcl-s BUFFER_SIZE int(10) inz(128000);


          /////////////////////////////////////////////////////////////////
          //  Main Calc specs start here
          /////////////////////////////////////////////////////////////////
     dcl-proc main ;
          dcl-pi main EXTPGM('JOB_LIBL');

               // Input parameters
          inJobID   VARCHAR(28) const;
          inPORTION VARCHAR(10) const;  // SYS, USR, CUR, PROD, etc.

               // Output Columns
          SEQNBR  int(10);
          LIBNAME VARCHAR(10);
          PORTION VARCHAR(10);
          LIBTYPE VARCHAR(5);  // *PROD or *TEST
          LIBTEXT VARCHAR(50);
          iASP_Nbr int(5);
          iASP_Name VARCHAR(10);
          iASP_Group VARCHAR(10);
          OBJ_COUNT INT(10);
          PORTION_AS_TYPE VARCHAR(10);  // Dup of PORTION returned as "TYPE"
          job VARCHAR(28);

               // Input indicators
          indy_inJOBID    int(5);
          indy_inPORTION  int(5);

               // Output Column Indicators
        // Output Columns
          indy_seqNbr int(5);
          indy_LIBNAME int(5);
          indy_PORTION int(5);
          indy_LIBTYPE int(5);
          indy_LIBTEXT int(5);
          indy_iASP_Nbr int(5);
          indy_iASP_Name int(5);
          indy_iASP_Group int(5);
          indy_OBJ_COUNT  int(5);
          indy_PORTION_AS_TYPE int(5);
          indy_job int(5);

               // Standard DB2SQL scratchpad/diagnostic fields
          outSQLSTATE   CHAR(5);
          inFuncName    VARCHAR(517) CONST;  // Function name
          inSpecName    VARCHAR(128) CONST;  // Specific function name
          outSQLMSG     VARCHAR(70);
          scratchPad    LIKEDS(scratch_t); // ScratchPad
          inSQLOpCode   INT(10) CONST; // -1=Open, 0=Fetch, 1=Close
     end-pi;

     dcl-ds jobID LikeDS(jobid_T);
     dcl-s  intJOBID char(16) inz;
     dcl-s  LIBL_SECTION char(10) inz('*');
     dcl-s  scratchPad_Len int(10);
     dcl-ds ec likeDS(qusec_t) inz(*LIKEDS);
     dcl-ds libl LIKEDS(Qwc_JOBI0750_T) based(pLibl);
     dcl-s  pSysLibs pointer inz(*NULL);
     dcl-s  pProdLibs pointer inz(*NULL);
     dcl-s  pCurLibs pointer inz(*NULL);
     dcl-s  pUserLibs pointer inz(*NULL);
     dcl-ds lible likeDS(Qwc_Lib_List2_T) based(pLiblE);

     IF (inSQLOpCode = SQL_OPEN);  // Open?
          scratchPad_Len = scratchPad.length;
          clear scratchPad;
          scratchPad.length = scratchPad_Len;

          if (indy_inJOBID >= 0 and inJobID <> '*' and inJobID <> '');  // Use current job
            scratchPad.jobID = splitJobName( inJobID );
          else;
            scratchPad.JobID.JOB_NAME = '*';
          endif;
          pLibl = crtTempUsrSpace( scratchPad.LIBL_US );
          if (pLibl = *NULL);
            snd-msg %TRIMR(psds.pgmname) + ' Pointer to User space is NULL. Request cancelled.';
            outSQLSTATE = '38701';
            return;
          endif;
          reset ec;
          QUSRJOBI(libl : BUFFER_SIZE : 'JOBI0750' :
                         scratchPad.jobID : intJOBID : ec);
          if (ec.bytes_returned > 0);
             snd-msg %TRIMR(psds.pgmname) + ' QUSRJOBI returned ' + ec.msgid;
             outSQLSTATE = '38701';
             return;
          endif;

          if (indy_PORTION >= 0 and inPORTION <> ' ');
               LIBL_SECTION = %upper(inPORTION);
               if (%SUBST(LIBL_SECTION : 1 : 1) = '*');
                    LIBL_SECTION = %SUBST(LIBL_SECTION : 2);
               endif;
                    // If *ALLUSR or *ALLUSRLIBL etc., then
                    // return everything except the System Portion of the LIBL
               if (%SUBST(LIBL_SECTION : 1 : 4) = 'ALLU');
                    LIBL_SECTION = '*';  // We use '*' to mean *ALL portions
               elseif (%SUBST(LIBL_SECTION : 1 : 1) in %LIST(' ' : 'A'));
                    LIBL_SECTION = 'A';  // We use '*' to mean *ALL portions
               else;
                    LIBL_SECTION = %SUBST(LIBL_SECTION : 1 : 1);
               endif;
          endif;

          if (libl.Offset_Sys_Libs > 0 and LIBL_SECTION in %LIST(' ':'A'));
               scratchPad.SYSLIBS = libl.Number_Sys_Libs;
          endif;
          if (libl.Offset_Prod_Libs > 0 and LIBL_SECTION in %LIST('*':'A':'P'));
               scratchPad.PRDLIBS = libl.Number_Prod_Libs;
          endif;
          if (libl.Offset_Curr_Libs > 0 and LIBL_SECTION in %LIST('*':'A':'C'));
               scratchPad.CURLIBS = libl.Number_Curr_Libs;
          endif;
          if (libl.Offset_User_Libs > 0 and LIBL_SECTION in %LIST('*':'A':'U'));
               scratchPad.USRLIBS = libl.Number_User_Libs;
          endif;
          scratchPad.LIBLSIZE = scratchPad.SYSLIBS +
                                scratchPad.PRDLIBS +
                                scratchPad.CURLIBS +
                                scratchPad.USRLIBS;

     endif;

     if (inSQLOpCode = SQL_FETCH and scratchPad.eof <> 0);
          outSQLState = '02000';  // End of file
          return;
     endif;

     IF (inSQLOpCode = SQL_FETCH);  // Fetch?
          reset ec;
          qusptrus( scratchPad.LIBL_US : pLibl : ec );

          if (pLibl = *NULL or ec.bytes_returned > 0);
               snd-msg %TRIMR(psds.pgmname) + ' returned ' + ec.msgid;
               outSQLSTATE = '38701';
               scratchPad.eof = 1;
               return;
          endif;

          if (libl.Offset_Sys_Libs > 0);
               pSysLibs = pLibl + libl.Offset_Sys_Libs;
          endif;
          if (libl.Offset_Prod_Libs > 0);
               pProdLibs = pLibl + libl.Offset_Prod_Libs;
          endif;
          if (libl.Offset_Curr_Libs > 0);
               pCurLibs = pLibl + libl.Offset_Curr_Libs;
          endif;
          if (libl.Offset_User_Libs > 0);
               pUserLibs = pLibl + libl.Offset_User_Libs;
          endif;

          scratchPad.counter += 1;

          if (pSysLibs <> *NULL and scratchPad.SYSLIBS_COUNTER < scratchPad.SYSLIBS);
               // Process System Library Portion of Library list
               pLiblE =  (pSysLibs + (scratchPad.SYSLIBS_COUNTER * libl.Lng_One_Lib_Entry));
               scratchPad.SYSLIBS_COUNTER += 1;
               PORTION = 'SYSTEM';
               PORTION_AS_TYPE = 'SYS';

          elseif (pProdLibs <> *NULL and scratchPad.PRDLIBS_COUNTER < scratchPad.PRDLIBS);
               // Process Product Library names
               pLiblE =  (pProdLibs + (scratchPad.PRDLIBS_COUNTER * libl.Lng_One_Lib_Entry));
               scratchPad.PRDLIBS_COUNTER += 1;
               PORTION = 'PRODUCT';
               PORTION_AS_TYPE = 'PRD';

          elseif (pCurLibs <> *NULL and scratchPad.CURLIBS_COUNTER < scratchPad.CURLIBS);
               // Process Product Library names
               pLiblE =  (pCurLibs + (scratchPad.CURLIBS_COUNTER * libl.Lng_One_Lib_Entry));
               scratchPad.CURLIBS_COUNTER += 1;
               PORTION = 'CURRENT';
               PORTION_AS_TYPE = 'CUR';

          elseif (pUserLibs <> *NULL and scratchPad.USRLIBS_COUNTER < scratchPad.USRLIBS);
               // Process Product Library names
               pLiblE =  (pUserLibs + (scratchPad.USRLIBS_COUNTER * libl.Lng_One_Lib_Entry));
               scratchPad.USRLIBS_COUNTER += 1;
               PORTION = 'USER';
               PORTION_AS_TYPE = 'USR';
          else;
               scratchPad.eof = 1;
               outSQLState = '02000';
               return;
          endif;

          library_Info = getLibDesc( lible.lib_name );

                  // Output Columns
          seqNbr = scratchPad.counter;
          LIBNAME = lible.lib_name;
          LIBTYPE = library_Info.lib_type;
          LIBTEXT = lible.Lib_Text;
          iASP_Nbr = lible.iASP_Nbr;
          iASP_Name = lible.iASP_Name;
          iASP_Group = library_Info.iASP_Group;
          OBJ_Count  = library_Info.OBJ_Count;

          job =  %TrimR(libl.Job_Number) + '/' +
                 %TrimR(libl.User_Name) + '/' +
                 %trimR(libl.Job_Name);

     elseif (inSQLOpCode = SQL_CLOSE);  // Close
        snd-msg 'Deleting *USRSPC ' +
                    %TRIMR(%SUBST(scratchPad.LIBL_US: 1 : 10)) +
                    ' in ' + %TRIMR(%SUBST(scratchPad.LIBL_US: 11 : 10));
        dltusrspace( scratchPad.LIBL_US);
     endif;

end-proc;

   dcl-proc dltusrspace;
     dcl-pi dltusrspace;
        userSpace  char(20) const;
     end-pi;
     dcl-ds ec likeds(QUSEC_T) inz(*LIKEDS);
       dcl-pr QLIDLTO  extPgm('QLIDLTO');
         objectName char(20) Const;
         objType    char(10) Const;
         ASP_NAME   char(10) Const;  // Use '*'
         rmvMsg     char(1)  Const;  // '1'=remove "User Space deleted" msg
         api_error  LikeDS(QUSEC_T) OPTIONS(*VARSIZE:*NOPASS);
       end-pr;
       reset ec;
       QLIDLTO( userSpace :'*USRSPC' : '*' : '1' : ec);
       return;
   end-proc;


//------------------------------------------------------------------
// Procedure: SplitJobName
// Purpose:   Splits 'nnnnnn/user/jobname' into a qualified structure
//------------------------------------------------------------------
DCL-PROC splitJobName;
     DCL-PI splitJobName LIKEDS(JOBID_T);  // returns the structure
          inQualJob VARCHAR(28) CONST; // Format: nnnnnn/user/jobname
     END-PI;

     DCL-DS jobID LIKEDS(JOBID_T);
     DCL-S firstSlash  INT(5);
     DCL-S secondSlash INT(5);

  // Find the positions of both slashes
     firstSlash  = %SCAN('/' : inQualJob);
     secondSlash = %SCAN('/' : inQualJob : firstSlash + 1);

  // Extract the subfields based on slash locations
     IF firstSlash > 1;
          jobID.JOB_NBR = %SUBST(inQualJob : 1 : firstSlash - 1);
     ENDIF;

     IF secondSlash > firstSlash + 1;
          jobID.JOB_USER = %SUBST(inQualJob : firstSlash + 1 : secondSlash - firstSlash - 1);
          jobID.JOB_NAME = %SUBST(inQualJob : secondSlash + 1);
     ENDIF;

     RETURN %UPPER(jobID);
END-PROC;

     dcl-proc crtTempUsrSpace;
       dcl-pi crtTempUsrSpace  pointer;
         rtnUsrSpaceName  char(20);
       end-pi;
       dcl-ds ec likeDS(qusec_t) inz(*LIKEDS);

     dcl-pr QUSCRTUS  extPgm('QUSCRTUS');
          userSpace char(20) Const;
          extAttr char(10) Const;
          initSize int(10) Const;
          initValue char(1) Const;
          pubAuth char(10) Const;
          textDesc char(50) Const;
          replace char(10) Const;
          api_Error  LikeDS(QUSEC_T) OPTIONS(*VARSIZE : *NOPASS);
          bSysDomain char(10) Const OPTIONS(*NOPASS);
     end-pr QUSCRTUS;

     dcl-pr QUSCHGUS  ExtPgm('QUSCHGUS');
          szUsrSpace char(20) Const;
          nStart int(10) Const;
          nLength int(10) Const;
          szData char(65535) Const options(*VARSIZE);
          bForceAux char(1) Const;
          api_error  LikeDS(QUSEC_T) OPTIONS(*VARSIZE:*NOPASS);
     end-pr QUSCHGUS;

          dcl-s  uniqueTM timestamp(12);
          dcl-s  uniqueID char(7);
          dcl-s  tempName varchar(10);
          dcl-s  rtnPtr pointer inz(*NULL);
          dcl-ds usName Qualified;
               name    char(10);
               library char(10);
          end-ds;

          uniqueTM = %TIMESTAMP(*UNIQUE);
          snd-msg %char(uniqueTM);
          uniqueID = %SUBST(%char(uniqueTM) : 21 : 7);
          tempName = 'C4I' + uniqueID;
          usName.name = tempName;
          usName.library = 'QTEMP';

          reset ec;
          // Note: For library Lists, no need to change it to auto-extend. 128k is plenty
          quscrtus( usName : 'C4i_LIBL' : BUFFER_SIZE : X'00' : '*ALL' :
                    'JOB_LIBL Table function work space' : '*YES' :
                    ec);
          reset ec;
          qusptrus( usName : rtnPtr : ec);
          rtnUsrSpaceName = usName;
          return rtnPtr;
     end-proc;

     dcl-proc getLibDesc;
       dcl-pi getLibDesc likeds(library_Info) rtnparm;
          library varchar(10) const;
       end-pi;


       dcl-ds ec likeDS(qusec_t) inz(*LIKEDS);
       dcl-s buffer char(1024);
       dcl-ds libd qualified based(pLibD);
          returned_data_length  int(10);
          key_id                int(10);
          size_of_value         int(10);
          lib_Attr              CHAR(50);
          lib_type              CHAR(1) OVERLAY(LIB_ATTR);
          iASP_Nbr              INT(10) OVERLAY(LIB_ATTR);
          iASP_Name             CHAR(10) OVERLAY(LIB_ATTR);
          iASP_Group            CHAR(10) OVERLAY(LIB_ATTR);
          OBJ_COUNT             INT(10) OVERLAY(LIB_ATTR);
       end-ds;
       dcl-ds libInfo likeds(library_Info) Inz;

       dcl-s libName char(10);
       dcl-s i int(10);
       dcl-ds libDesc qualified based(plibDesc);
          Bytes_Returned  int(10);
          Bytes_Available int(10);
          Vlen_Records_Returned  int(10);
          Vlen_Records_Available int(10);
       end-ds;
       dcl-ds libInfo_Keys qualified inz;
         keys int(10);  // Number of key identifiers to return
         key  int(10)  dim(7);
       end-ds;
       dcl-pr QLIRLIBD extPgm('QLIRLIBD');
          libInfo_rtnBuffer char(256) Options(*VARSIZE);
          rtnBufferLen int(10) Const;
          library_name char(10) Const;
          Keys   LikeDS(libInfo_Keys) const OPTIONS(*VARSIZE);
          api_error  LikeDS(QUSEC_T) OPTIONS(*VARSIZE);
       end-pr QLIRLIBD;

       libInfo_Keys.keys = 5;
       libInfo_Keys.key(1) = 1; // Type of Library char(1)
       libInfo_Keys.key(2) = 2; // iASP_Number int(10)
       libInfo_Keys.key(3) = 8; // iASP_Name   char(10)
       libInfo_Keys.key(4) = 7; // Object_Count int(10)
       libInfo_Keys.key(5) = 9; // iASP_Group  char(10)
       libName = library;
          reset ec;
          QLIRLIBD( buffer : %size(BUFFER) : libName : libInfo_Keys : ec);
          if (ec.Bytes_Returned > 0);
            snd-msg %TRIMR(psds.pgmname) + ' getLibDesc returned ' + ec.msgid;
            return ec.msgid;
          endif;
          plibDesc = %addr(buffer);
          pLibD = %addr(buffer) + %size(libDesc);
          clear libInfo;
       for i = 1 to libDesc.Vlen_Records_Returned;
          if (libd.returned_data_length > 0 and libd.size_of_value > 0);
               select;
                 when libd.key_ID = 1; // lib type (prod/test)
                   if (libd.lib_type = '0');
                    libinfo.lib_type = '*PROD';
                   elseif (libd.lib_type = '1');
                    libinfo.lib_type = '*TEST';
                   endif;
                 when libd.key_id = 2;
                    libInfo.iASP_Nbr = libd.iASP_Nbr;
                 when libd.key_id = 7;
                    libInfo.obj_count = libd.obj_count;
                 when libd.key_id = 8;
                    libInfo.iASP_Name = libd.iASP_Name;
                 when libd.key_id = 9;
                    libInfo.iASP_Group = libd.iASP_Group;
               endsl;
          endif;
          pLibd += libd.returned_data_length;
       endfor;
       return libInfo;
     end-proc;
`;
}
