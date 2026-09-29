/**
 * Embedded source for JOB_INFO RPGLE external program.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/JOB_INFO/job_info.rpgle
 * RPGLE is intentionally stored as plain text (not base64-encoded).
 */
export function getJobInfoRPGLESrc(): string {
    return `**free

// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 by R. Cozzi, Jr.


  // @author BobCozzi

    ////////////////////////////////////////////////////////////////////////
    // IBM i Retrieve Job Info
    // This is an SQL UDTF External Program
    // It uses the QUSRJOBI API to retreive Job Information
    // This information is currently not available via QSYS2 SQL functions
    ////////////////////////////////////////////////////////////////////////
    // This is part of the collection of open source SQL UDTFs that are
    // primarily built for the VS CODE and CODE for IBM i IDE, however
    // they can certainly be feely used in production environments on IBM i
    // Available on github at:  https://github.com/bobcozzi/open-UDTF
    ////////////////////////////////////////////////////////////////////////

ctl-opt   main(main) DFTACTGRP(*NO) ACTGRP(*CALLER) OPTION(*SRCSTMT);


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

dcl-ds JOBID_T Qualified Template;
     JOB_NAME char(10);
     JOB_USER char(10);
     JOB_NBR char(6);
end-ds;

dcl-pr QUSRJOBI EXTPGM('QUSRJOBI');
     rtnJobInfo char(6000) OPTIONS(*VARSIZE);
     rtnJobInfoSize int(10) Const;
     APIFORMAT  char(8) Const;
     JobID      char(26) Const;
     InternalJobID char(16) Const;
     apiError  LikeDS(QUSEC_T) OPTIONS(*VARSIZE);
end-pr QUSRJOBI;

dcl-pr cvthc  extProc('cvthc');
     szHexVal  char(65534) OPTIONS(*VARSIZE);
     szCharVal char(32766) OPTIONS(*VARSIZE)  CONST;
     nHexLen int(10) Value;
end-pr;

dcl-s hexKey char(8);
dcl-s hexData char(64);

      // Converted from: <QSYSINC/H/QUSRJOBI>
dcl-ds Qwc_JOBI0200_T  Qualified Inz TEMPLATE;
     Bytes_Return INT(10);
     Bytes_Avail INT(10);
     Job_Name CHAR(10);
     User_Name CHAR(10);
     Job_Number CHAR(6);
     Int_Job_ID CHAR(16);
     Job_Status CHAR(10);
     Job_Type CHAR(1);
     Job_Subtype CHAR(1);
     Subsys_Name CHAR(10);
     Run_Priority INT(10);
     System_Pool_ID INT(10);
     CPU_Used INT(10);
     Aux_IO_Request INT(10);
     Interact_Trans INT(10);
     Response_Time INT(10);
     Function_Type CHAR(1);
     Function_Name CHAR(10);
     Active_Job_Stat CHAR(4);
     Num_DBase_Lock_Wts INT(10);
     Num_Internal_Mch_Lck_Wts INT(10);
     Num_Non_DBase_Lock_Wts INT(10);
     Wait_Time_DBase_Lock_Wts INT(10);
     Wait_Time_Internal_Mch_Lck_Wts INT(10);
     Wait_Time_Non_DBase_Lock_Wts INT(10);
     Reserved CHAR(1);
     Current_System_Pool_ID INT(10);
     Thread_Count INT(10);
     CPU_Used_Long UNS(20);
     Aux_IO_Request_Long UNS(20);
     CPU_Used_DB_Long UNS(20);
     Page_Faults_Long UNS(20);
     Active_Job_Stat_Ending_Jobs CHAR(4);
     Memory_Pool_Name CHAR(10);
     Message_Reply CHAR(1);
     Message_Key CHAR(4);
     Message_Queue CHAR(10);
     Message_Queue_Library CHAR(10);
     Message_Queue_Lib_ASP CHAR(10);
end-ds;  // Qwc_JOBI0200_T

               // Converted from: <QSYSINC/H/QUSRJOBI>
dcl-ds Qwc_JOBI0300_T  Qualified Inz TEMPLATE;
     Bytes_Return INT(10);
     Bytes_Avail INT(10);
     Job_Name CHAR(10);
     User_Name CHAR(10);
     Job_Number CHAR(6);
     Int_Job_ID CHAR(16);
     Job_Status CHAR(10);
     Job_Type CHAR(1);
     Job_Subtype CHAR(1);
     Jobq_Name CHAR(10);
     Jobq_Lib CHAR(10);
     Jobq_Priority CHAR(2);
     Outq_Name CHAR(10);
     Outq_Lib CHAR(10);
     Outq_Priority CHAR(2);
     Prt_Dev_Name CHAR(10);
     Subm_Job_Name CHAR(10);
     Subm_User_Name CHAR(10);
     Subm_Job_Num CHAR(6);
     Subm_Msgq_Name CHAR(10);
     Subm_Msgq_Lib CHAR(10);
     Sts_On_Jobq CHAR(10);
     Date_Put_On_Jobq CHAR(8);
     Job_Date CHAR(7);
     Jobq_Lib_ASP_Dev CHAR(10);
end-ds;  // Qwc_JOBI0300_T

dcl-ds scratch_t Qualified Template;
     length int(10);
     eof    int(10);
     jobID  likeds(jobid_t);
end-ds;

dcl-proc main ;
     dcl-pi main EXTPGM('JOB_INFO'); // Add SQL UDTF Input/Output Parameters and indicators

               // Input parameters
          inJobID  varchar(28) const;

               // Output Columns
          job varchar(28);
          job_Name varchar(10);
          job_user varchar(10);
          job_nbr  varchar(6);
          Job_Date date;

          Job_Status VARCHAR(10);
          Job_Type VARCHAR(1);
          Job_Subtype VARCHAR(1);
          Subsys_Name VARCHAR(10);
          Function_Name VARCHAR(14);
          Active_Job_Stat VARCHAR(4);
          Run_Priority INT(10);
          Memory_Pool_Name VARCHAR(10);
          System_Pool_ID INT(10);
          Message_Reply VARCHAR(1);
          MSGKEY_HEX  VARCHAR(8);
          Message_Key CHAR(4);
          Message_Queue VARCHAR(10);
          Message_Queue_Library VARCHAR(10);
          Message_Queue_Lib_ASP VARCHAR(10);
          Outq_Name VARCHAR(10);
          Outq_Lib VARCHAR(10);
          Outq_Priority VARCHAR(2);
          Prt_Dev_Name VARCHAR(10);

               // Input indicators
          indy_inJOBID  int(5);

               // Output Column Indicators
          indy_job int(5);
          indy_job_Name  int(5);
          indy_job_user  int(5);
          indy_job_nbr   int(5);
          indy_Job_Date  int(5);
          indy_Job_Status  int(5);
          indy_Job_Type    int(5);
          indy_Job_Subtype  int(5);
          indy_Subsys_Name  int(5);
          indy_Function_Name  int(5);
          indy_Active_Job_Stat  int(5);
          indy_Run_Priority  int(5);
          indy_Memory_Pool_Name  int(5);
          indy_System_Pool_ID  int(5);
          indy_Message_Reply  int(5);
          indy_Message_Key_HEX  int(5);
          indy_Message_Key  int(5);
          indy_Message_Queue  int(5);
          indy_Message_Queue_Library  int(5);
          indy_Message_Queue_Lib_ASP  int(5);
          indy_Outq_Name  int(5);
          indy_Outq_Lib  int(5);
          indy_Outq_Priority  int(5);
          indy_Prt_Dev_Name  int(5);

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
     dcl-ds ec likeDS(qusec_t) inz(*LIKEDS);
     dcl-ds buffer200 LIKEDS(Qwc_JOBI0200_T) INZ;
     dcl-ds buffer300 LIKEDS(Qwc_JOBI0300_T) INZ;

     IF (inSQLOpCode = -1);  // Open?
          scratchPad.eof = 0;
          clear scratchPad.jobID;
          if (indy_inJOBID >= 0 and inJobID <> '*' and inJobID <> '');  // Use current job
               scratchPad.jobID = splitJobName( inJobID );
          else;
               scratchPad.JobID.JOB_NAME = '*';
          endif;
     endif;

     if (scratchPad.eof <> 0);
          outSQLState = '02000';  // End of file
          return;
     endif;

     IF (inSQLOpCode = 0);  // Fetch?
          scratchPad.eof = 1;
          reset ec;
          QUSRJOBI( buffer200 : %size(buffer200) : 'JOBI0200' :
                         scratchPad.jobID : intJOBID : ec);
          reset ec;
          QUSRJOBI( buffer300 : %size(buffer300) : 'JOBI0300' :
                         scratchPad.jobID : intJOBID : ec);

          job = %upper(inJOBID);
          Job_Name = buffer200.Job_Name;
          Job_User = buffer200.User_Name;
          Job_nbr = buffer200.Job_Number;
          Job_Status = buffer200.Job_Status;
          Job_Type = buffer200.Job_Type;
          Job_Subtype = buffer200.Job_Subtype;
          Subsys_Name = buffer200.Subsys_Name;

          if ((buffer200.Function_Type <> ' ' and buffer200.Function_Type <> X'00') and
              (buffer200.Function_Name <> ' ' and buffer200.Function_Name <> *ALLX'00'));
               Function_Name = %trimR(buffer200.Function_Type) + '-' + %trimR(buffer200.Function_Name);
          else;
               indy_Function_name = -1;
          endif;
          Active_Job_Stat  = buffer200.Active_Job_Stat;
          Run_Priority  = buffer200.Run_Priority;
          Memory_Pool_Name  = buffer200.Memory_Pool_Name;
          System_Pool_ID  = buffer200.System_Pool_ID;

          if (buffer200.Message_Reply <> ' ' and buffer200.Message_Reply <> X'00');
               Message_Reply  = buffer200.Message_Reply;
          else;
               indy_Message_Reply = -1;
          endif;

          if (buffer200.Message_Key <> ' ' and buffer200.Message_Key <> X'00000000');
               Message_Key  = buffer200.Message_Key;
               cvthc(hexKey : buffer200.Message_Key : 8 );
               MSGKEY_HEX = hexKey;
          else;
               indy_Message_Key = -1;
               indy_Message_Key_HEX = -1;
          endif;
          if (buffer200.Message_Queue <> ' ' and buffer200.Message_Queue <> *ALLX'00');
               Message_Queue  = buffer200.Message_Queue;
               Message_Queue_Library  = buffer200.Message_Queue_Library;
               Message_Queue_Lib_ASP  = buffer200.Message_Queue_Lib_ASP;
          else;
               indy_Message_Queue = -1;
               indy_Message_Queue_Library = -1;
               indy_Message_Queue_Lib_ASP = -1;
          endif;

          if (buffer300.Outq_Name <> ' ' and buffer300.Outq_Name <> *ALLX'00');
               Outq_Name  = buffer300.Outq_Name;
               Outq_Lib  = buffer300.Outq_Lib;
               Outq_Priority  = buffer300.Outq_Priority;
          else;
               indy_Outq_Name  = -1;
               indy_Outq_Lib  = -1;
               indy_Outq_Priority = -1;
          endif;

          if (buffer300.Prt_Dev_Name <> ' ' and buffer300.Prt_Dev_Name <> *ALLX'00');
               Prt_Dev_Name  = buffer300.Prt_Dev_Name;
          else;
               indy_Prt_Dev_Name = -1;
          endif;

          if (buffer300.Job_Date <> ' ' and buffer300.Job_Date <> *ALLX'00');
               monitor;
                    Job_Date  = %DATE(buffer300.Job_Date : *CYMD0);
               on-error;
                    indy_job_date = -1;
               endmon;
          else;
               indy_job_date = -1;
          endif;

     elseif (inSQLOpCode = 1);  // Close
            // Do close up stuff here
     endif;

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
`;
}
