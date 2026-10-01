/**
 * Embedded source for CMD_RUN.CPP.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/CMD_RUN/CMD_RUN.CPP
 * Stored as plain text (no base64 encoding).
 */
export function getCmdRunCPPSrc(): string {
    return String.raw`// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 by R. Cozzi, Jr.


  // @author BobCozzi

    ////////////////////////////////////////////////////////////////////////
    // IBM i CL Command Processor for SQL
    // This is an SQL UDTF External Program
    // It uses the QCAPCMD API to run or syntax check CL commands
    // in various IBM i environments (OPM, ILE, CL Program, Command Line, etc.)
    ////////////////////////////////////////////////////////////////////////
    // This is part of the collection of open source SQL UDTFs that are
    // primarily built for the VS CODE and CODE for IBM i IDE, however
    // they can certainly be feely used in products such as:
    //  - IBM ACS RUNSQL Scripts
    //  - SQL iQuery
    //  Available on github at:  https://github.com/bobcozzi/open-UDTF
    ////////////////////////////////////////////////////////////////////////

#ifndef __STDC_WANT_DEC_FP__
#define __STDC_WANT_DEC_FP__
#endif

#ifndef __POSIX_LOCALE__
#define __POSIX_LOCALE__
#endif


#include <sys/time.h>
#include <sys/stat.h>
#include <sys/types.h>

#pragma datamodel(P128)

#include <stdlib.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <ctype.h>
#include <inttypes.h>
#include <langinfo.h>
#include <except.h>
#include <signal.h>

#include <QP0LSTDI.h>
#include <QP0ZTRC.h>     // Qp0zLprintf

#include <qusec.h>
#include <qlg.h>
#include <qlgcase.h>
#include <letype.h>
#include <lecond.h>
#include <leenv.h>

#include <QMH.h>
#include <QMHSNDPM.h>
#include <QMHRCVPM.h>
#include <QMHRMVPM.h>
#include <QMHRTVM.h>

#include <QUSCRTUS.h>
#include <QUSCUSAT.h>
#include <QUSPTRUS.h>
#include <QLIDLTO.h>
#include <QLGCASE.h>
#include <QUSRJOBI.h>

#include <qcapcmd.h>

  // include syntax when compiling from an IFS stream file
#include <mih/cpybytes.h>
#include <mih/triml.h>
#include <mih/MATPGMNM.h>


#include <cstring>
#include <cctype>
#include <string>
#include <memory>

#include <vector>
#include <algorithm>

using namespace std;

#include <sql.h>
#include <sqludf.h>

const int coz_MAXUSRSPACESIZE = 16711568;
const int coz_MAXMEM15M = 15662992;
/* Case-conversion direction constants */
#ifndef _TOUPPER
#define _TOUPPER 0
#endif
#ifndef _TOLOWER
#define _TOLOWER 1
#endif

/* ============================================= */
/* coz_qusec - IBM i standard error code wrapper */
/* ============================================= */

typedef struct tag_QUS_EC
 {
    union { int  Bytes_Provided; int  length; };
    union { int  Bytes_Available; int  Bytes_Returned; };
    union { char Exception_Id[7]; char msgid[7]; };
    char Reserved;
    union { char Exception_Data[255]; char msgdta[255]; };
 } qusec_t;


class coz_qusec {
public:
    coz_qusec() { init(); }
    void init() {
        memset((char*)&ec, 0x00,
               sizeof(ec) + sizeof(xtra));
        ec.Bytes_Provided =
            (int)(sizeof(ec) + sizeof(xtra));
    }
    void clear() {
        init();
        ec.Bytes_Provided = 0;
    }
    void reset() { init(); }
    int isEmpty() {
        return ec.Bytes_Available == 0;
    }
    int isNotEmpty() {
        return ec.Bytes_Available != 0;
    }
    int hasError() {
        return ec.Bytes_Available > 0;
    }
    int isError() {
        return ec.Bytes_Available > 0;
    }
    int hasNoError() {
        return ec.Bytes_Available == 0;
    }
    /* Compare Exception_Id up to 7 chars */
    bool compare(const char* pMsgID) {
        if (ec.Bytes_Available == 0)
            return false;
        int n = (int)strlen(pMsgID);
        if (n > 7) n = 7;
        return (memcmp(ec.Exception_Id,
                       pMsgID, n) == 0);
    }
    char* msgid() {
        return ec.Exception_Id;
    }
    bool startsWith(const char* prefix) {
        return strncmp(ec.Exception_Id, prefix, std::min<int>(7,std::strlen(prefix))) == 0;
    }
    char* msgdata() {
        int avail = ec.Bytes_Available;
        if (avail > 16) {
            char* p = (char*)&ec + 16;
            int dlen = avail - 16;
            if (dlen < (int)sizeof(xtra))
                p[dlen] = 0x00;
            return p;
        }
        return NULL;
    }
    int getMsgDataLen() {
        int a = ec.Bytes_Available;
        return (a > 16) ? a - 16 : 0;
    }
    operator void*()     { return &ec; }
    operator Qus_EC_t*() {
        return (Qus_EC_t*)&ec;
    }
private:
    qusec_t ec;
    char    xtra[256];
};


bool startsWith(const char* str, const char* prefix) {
    return strncmp(str, prefix, std::strlen(prefix)) == 0;
}

int makeUpper(char* szData, int inLen = 0, int ccsid = 0)
{

  Qlg_CCSID_ReqCtlBlk_T frcb;
  coz_qusec      ec;
  long       len = 0;
  char*      pIn = szData;
  char*      pOut= szData;

  memset((char*)&frcb,0x00,sizeof(frcb));
  frcb.Type_of_Request = 1;
  frcb.Case_Request = _TOUPPER;
  frcb.CCSID_of_Input_Data = ccsid;

  if (inLen <= 0)
  {
    len = strlen(pIn);
  }
  else
  {
    len = inLen;
  }

  ec.init();
  if (len > 0)
  {
    QlgConvertCase( (char*) &frcb, (char*)pIn,
                     pOut, &len ,
                    (char*) &ec);
  }
  return len;
}


int makeLower(char* szData, int inLen = 0, int ccsid = 0)
{

  Qlg_CCSID_ReqCtlBlk_T frcb;
  coz_qusec ec;
  long       len = 0;
  char*      pIn = szData;
  char*      pOut= szData;

  memset((char*)&frcb,0x00,sizeof(frcb));
  frcb.Type_of_Request = 1;
  frcb.Case_Request = _TOLOWER;  // 0=Upper 1=Lower
  frcb.CCSID_of_Input_Data = ccsid;

  if (inLen <= 0)
  {
    len = strlen(pIn);
  }
  else
  {
    len = inLen;
  }

  ec.init();
  if (len > 0)
  {
    QlgConvertCase( (char*) &frcb, (char*)pIn,
                     pOut, &len ,
                    (char*) &ec);
  }
  return len;
}



inline char* coz_getNextParmIf(int& pC, int& argc, char** argv, int ioFlag = 0);


#define inChar(_v) \
          char *in##_v = \
          (char*) coz_getNextParmIf(p,argc,argv)
#define inInt(_v)  \
          int   *in##_v = \
          (int *)coz_getNextParmIf(p, argc, argv)

#define outChar(_v) \
           char  *out##_v = \
           (char *)coz_getNextParmIf(p, argc, argv, 1)

#define outSmallInt(_v) \
           short *out##_v = \
           (short *)coz_getNextParmIf(p, argc, argv, 2)
#define outInt(_v)   \
           int  *out##_v = \
           (int *)coz_getNextParmIf(p, argc, argv)
#define outBigInt(_v) \
           long long *out##_v = \
           (long long *)coz_getNextParmIf(p, argc, argv, 8)

#define inIndy(_v) \
    short *indyIn##_v = \
        (short*) coz_getNextParmIf(p,argc,argv)
#define outIndy(_v) \
    short *indy##_v = \
        (short*) coz_getNextParmIf(p,argc,argv,2)

#define cpyFixedToStr(dest, src, srclen)        \
    do {                                        \
        size_t i_copy = 0;                      \
        for (; i_copy < (srclen); ++i_copy) {   \
            if ((src)[i_copy] == '\0') break;   \
            (dest)[i_copy] = (src)[i_copy];     \
        }                                       \
        (dest)[i_copy] = '\0';                  \
    } while (0)

    // copyPad copies maxLen bytes from a fixed src to a fixed target with blank padding
inline void copyPad(char* dest, const char* src, int maxLen = 10)
{
    memset(dest, ' ', maxLen);
    _CPYBYTES(dest, src, std::min<int>(strlen(src),maxLen));
}

    // copyStrToFixed copies a C-string to a fixed length target but
    // copies no more than maxLen bytes.
inline void copyStrToFixed(char* dest, const char* src, int maxLen = 10)
{
    memset(dest, ' ', maxLen);
    _CPYBYTES(dest, src, std::min<int>(strlen(src), maxLen));
}

// #define makeAPIQualName(qualName, nm, lib) \
//    snprintf((qualName), 21, "%-10.10s%-10.10s", (nm).c_str(), (lib))

#define makeAPIObjName(_out, _obj, _lib) \
 memset(_out, ' ', 10); \
 _CPYBYTES(_out, _obj, std::min<int>(10,strlen(_obj))); \
 memset(_out+10, ' ', 10); \
 _CPYBYTES(_out+10, _lib, std::min<int>(10,strlen(_lib)))


#define MAX_MSGTEXT_LEN 2000  // Limit message text to the first 1k of data
#define MAX_SECLVL_LEN  4000  // Limit seclvl text to the first 2k of data
#define MAX_MSGKEY_COUNT 256  // Limit msgkeys saved and messages returned

typedef _Packed struct tagScratch
{
    int  len;  // scratch pad length as set by the SCRATCHPAD kwd in the UDTF
    char MSGINFO[21];
    char pgmName[11];
    char libName[11];
    int eof;
    int syntaxOption;  // Check or Run QCAPCMD runtype control option
    int msgcount;
    int current_msg;
    char RQSMSGKEY[4];
    char msgkey[MAX_MSGKEY_COUNT][4];
} scratch_t;


int getNextCmdMsg(scratch_t* pScratch, char* msgid, int* msgsev, char* pMsgType, char* msgtext, char* seclvl, Qmh_Rcvpm_Sender_t*& pSender);
int collectAllMsgKeys(scratch_t* pScratch);
int getMsgType(char* msgType, const char* msgtypeID);
void logCtrlBlock(const Qca_PCMD_CPOP0100_t& ctrlBlock);
int xlateCheckOption(const char* pProcessMode);

char *extractCLCmdName(const char* pCmd, char* rtnCmdName, int rtnCmdNameBufferSize = 11);
int isProhibitedCmd(const char* pCmd, char* pRtnCmdName, int rtnCmdNameBufferSize = 11);
int sndMsg(const char *pMsgID, const char *pMsgfile = "QCPFMSG", const char *pMsgFLib = "*LIBL");

    // Prototype for retrieve Message text
void rtvMsgText(char* pMsgText, int bufLen, coz_qusec& ec);
int sndrcvRQS(const char* pCmd, int cmdLen, scratch_t* pScratch);
int make3PartJobName(char* qualJob, const char* jobNbr, const char* jobUser, const char* jobName);
int copyUntil(char* t, const char* s, int maxLen = 10, const char* stopAt = NULL, bool bTrim = false);

inline int RMVMSG(const char* msgtype, const char* msgkey=NULL);
void coz_DLTOBJ(const char *qualObjName, const char *objType, const char *ASPName = "*");
char *coz_TEMP_USRSPACE(char *rtnUSName, const char *objAttr = "SQLTOOLS", int initSize = 4096);
char *coz_getPtrUsrSpace(const char *p2PartUsrSpaceName);


int main(int argc, char *argv[])
{
     /**********************************************************/
     /* Syntax Check or run CL commands via QCAPCMD API        */
     /**********************************************************/

    int p = 0;

    //////////////////////////////////////////////
    //  PARMS Parameter declaration section
    //////////////////////////////////////////////

    //////////////////////////////////////////////
    //  INPUT Parameters
    //////////////////////////////////////////////
    inChar(CMD);
    inChar(PROCESSMODE);

    //////////////////////////////////////////////
    //  OUTPUT Parameters
    //////////////////////////////////////////////
    outSmallInt(ORDPOS);  // IBM's "ORDINAL_POSITION" column for sequencing help
    outChar(MSGID);
    outInt(MSGSEV);
    outChar(MSGTYPE);
    outChar(SENDDTS);   // timestamp(0),
    outChar(MSGTEXT);   // Varchar(2000)

    outChar(SENDER);    // User profile underwhich the message is sent
    outChar(SENDPGM);
    outChar(SENDSTMT);   // char(4)
    outChar(SENDMOD);
    outChar(SENDPROC);

    outChar(TOPGM);
    outChar(TOSTMT);      // char(4),
    outChar(TOMOD);
    outChar(TOPROC);
    outChar(SECLVL);    // Varchar(4000)

     //////////////////////////////////////////////
     //  Input Indicator Fields
     //////////////////////////////////////////////
     inIndy(CMD);
     inIndy(PROCESSMODE);
        // Options may be any 1 of the following:
        // Note upper/lower case and leading asterisk are ignored.
        //   NULL or empty = Command Entry (non-program) CL (default)
        //   *CL   - Command Entry (non-program) CL
        //   *CLLE - ILE CL Program syntax
        //   *CLP  - OPM CL Program syntax
        //   *LIMIT - Limited User Commands
        //   *CMD  - Command Definition Commands
        //   *BND  - Binder Language Commands

     //////////////////////////////////////////////
     //  Output Indicator Fields
     //////////////////////////////////////////////
    outIndy(ORDPOS);
    outIndy(MSGID);      // set to 0 by the macro
    outIndy(MSGSEV);
    outIndy(MSGTYPE);
    outIndy(SENDDTS);   // timestamp(0),
    outIndy(MSGTEXT);    // 1st Level message text

    outIndy(SENDER);
    outIndy(SENDPGM);
    outIndy(SENDMOD);
    outIndy(SENDPROC);
    outIndy(SENDSTMT);   // char(4)
    outIndy(TOPGM);
    outIndy(TOMOD);
    outIndy(TOPROC);
    outIndy(TOSTMT);      // char(4),
    outIndy(SECLVL);     // 2nd level message test

     ////////////////////////////////////////////////////////////
     //  SQL specific parameters
     ////////////////////////////////////////////////////////////
     char *sqlstate     = (char *)coz_getNextParmIf(p, argc, argv);
     char *sqlFuncName     = (char *)coz_getNextParmIf(p, argc, argv);
     char *specificName = (char *)coz_getNextParmIf(p, argc, argv);
     char *sqlmsgtext   = (char *)coz_getNextParmIf(p, argc, argv);
     char *scratchPad   = (char *)coz_getNextParmIf(p, argc, argv);
     int  *sqlOpCode    = (int  *)coz_getNextParmIf(p, argc, argv);

     ////////////////////////////////////////////////////////////
     //  BEGIN main() body (after parms starts here)
     ////////////////////////////////////////////////////////////

    scratch_t* pScratch = (scratch_t *)scratchPad;

    _MATPGMNM_Template_T  pgm;
    memset(&pgm,0x00,sizeof(pgm));

      const int            MSGTEXT_LEN = 1024;
      char                 APIFMT[] = "CPOP0100";
      int                  ctlType = 0;
      int                  ctlInv = 0;

      _FEEDBACK            fc;
      coz_qusec           ec;

       if (*sqlOpCode == SQLUDF_TF_OPEN)
       {
        if (pScratch != NULL) {
            const int len = pScratch->len;
            if (len < (int) sizeof(scratch_t)) {
              Qp0zLprintf("[%s] Warning Scratch Pad Length=%d expected length=%d\n",sqlFuncName,len, (int) sizeof(scratch_t));
              Qp0zLprintf("Change %s UDTF SCRATCHPAD keyword to at least %d bytes\n",sqlFuncName, (int) sizeof(scratch_t)+4);
              strcpy(sqlstate,"02000");
              return 0;
            }
            // Clear entire scratch pad buffer passed in (even if longer than our typedef)
            memset(pScratch, 0x00, len);
            pScratch->len = len;          // re-assign the saved scratch pad length to the len member variable.
        }
        else {
            Qp0zLprintf("[%s] Warning Scratch Pad Length is 0 or NULL expected length=%d\n",sqlFuncName, (int) sizeof(scratch_t));
            Qp0zLprintf("Change %s UDTF SCRATCHPAD keyword to at least %d bytes\n",sqlFuncName, (int) sizeof(scratch_t));
            strcpy(sqlstate,"02000");
            return 0;
        }

        // "this" program's name

        pgm.Template_Size = sizeof(pgm);
        _MATPGMNM( &pgm );
        copyPad(pScratch->pgmName,pgm.Format_0.Name.Name,10);
        copyPad(pScratch->libName,pgm.Format_0.Context.Name,10);

    Qca_PCMD_CPOP0100_t  ctrlBlock;
    int                  ctrlBlockLen = sizeof(ctrlBlock);

    memset((char*)&ctrlBlock,0x00,sizeof(ctrlBlock));

    ctrlBlock.Command_Process_Type = 0;     // DFT: Mimic QCMDEXC
    ctrlBlock.DBCS_Data_Handling = '0';     // 0 = Ignore DBCS, 1 = Handle DBCS
    ctrlBlock.Prompter_Action = '0';        // 0 = Never prompt the command
    ctrlBlock.Command_String_Syntax = '0';  // 0 = IBM i syntax, 1 = System/38
    ctrlBlock.CCSID_Command_String = 0;
    memset(ctrlBlock.Message_Key,' ', sizeof(ctrlBlock.Message_Key));
    coz_TEMP_USRSPACE(pScratch->MSGINFO, "C4I_CMDRUN");


     int cmdLen = strlen(inCMD);   // Input CMD string length
     cmdLen = ::triml(inCMD, ' ');  // Get length of command (blank trimmed-right)
    // while (cmdLen > 0 && inCMD[cmdLen-1] == ' ') --cmdLen;

      // Calculate length for updated CMD string workspace
     int  rtnUpdatedCmdLen = 0;
     int  returnedCmdBufferLen = 0; // Not used/Deprecated: was = MAXCMD_LEN;
     char returnedCmdString[256];   // Not used/Deprecated was [MAXCMD_LEN]
     char* pRtnCmd = returnedCmdString;

     ctrlBlock.Command_Process_Type = 3;  // DFT(Command Entry Syntax checking)

     if (*indyInPROCESSMODE >= 0 && strlen(inPROCESSMODE) > 0)
     {
        while (*inPROCESSMODE == ' ' || *inPROCESSMODE == '*') {
               ++inPROCESSMODE;
        }
        char cmdCheckOption[64];
        strcpy(cmdCheckOption, inPROCESSMODE);
        makeUpper(cmdCheckOption);

        pScratch->syntaxOption = xlateCheckOption(cmdCheckOption);

        ctrlBlock.Command_Process_Type = pScratch->syntaxOption;

      }

      // logCtrlBlock(ctrlBlock);  // Used for development only
      int exceptionErrorHandlerTriggered = 0;

#pragma exception_handler(MONMSG, 0, 0, _C2_MH_ESCAPE | _C2_MH_FUNCTION_CHECK,\
                          _CTLA_HANDLE )

        sndrcvRQS(inCMD, cmdLen, pScratch);  // log CL command as a *RQS message
        char cmdName[11];
        if (isProhibitedCmd(inCMD, cmdName, sizeof(cmdName)))
        {
            sndMsg("CPF1038");
            strcpy(sqlstate, "57014");
            sprintf(sqlmsgtext,"For security reasons, command %s is not supported by %s.",
                                cmdName, sqlFuncName);
            Qp0zLprintf("SQLSTATE=%s Cause: %s\n","57014",sqlmsgtext);
            pScratch->eof = 1;
            return -1; // Restricted CL Command name
        }

        ec.clear();  // runtime errors get swallowed by the ec parameter
                   // so we clear it (set Bytes_Provided = 0) so all
                   // errors are pushed to the joblog. Ironically,
                   // this does not cause a runtime error for the QCAPCMD API.
                   // Likely because we used an exception_handler monitor.

          // MONMSG MSGID(CPF1907) ENDRQS (similar to SysReq -> 2 <Enter>)
 #pragma exception_handler(ENDRQS, 0,0, _C2_MH_ESCAPE, _CTLA_HANDLE_NO_MSG, "CPF1907")
         // RUN CL Command using QCAPCMD
      QCAPCMD(inCMD,
              cmdLen,
              &ctrlBlock,
              ctrlBlockLen,
              APIFMT,
              returnedCmdString,
              returnedCmdBufferLen,
              &rtnUpdatedCmdLen,
              &ec);

            goto  CLEAN_RUN; // Sorry. Legacy requirement for traping errors
ENDRQS:
            strcpy(sqlstate,"02000");
            pScratch->eof = 1;
MONMSG:
        // When an error occurs on the API call that is something like a parameter error,
        // then do your handler coding here and then "goto CONTINUE;"
        exceptionErrorHandlerTriggered = 1;

#pragma disable_handler
#pragma disable_handler

CLEAN_RUN:

      int keyCount = collectAllMsgKeys(pScratch);

      if (exceptionErrorHandlerTriggered > 0 && keyCount > 0)
      {
          Qp0zLprintf("[CMD_RUN] detected %d errors. %s\n", keyCount,
                        "See resultset data or low level messages for details.");
      }
      // Fetch and save the first 200 message keys to the scratch pad
      if (keyCount == 0)
      {
        pScratch->eof = 1;
        strcpy(sqlstate,"02000");
      }

    }  // end SQLUDF_TF_OPEN

    if (pScratch->eof != 0) {
      strcpy(sqlstate,"02000");
    }


      // SQLUDF_TF_FETCH  - F E T C H
    if (*sqlOpCode == SQLUDF_TF_FETCH)
    {
        Qmh_Rcvpm_Sender_t* pSender = NULL;

        // Qp0zLprintf("[CMD_RUN] FETCH detects %d msgkeys\n", pScratch->msgcount);
        if (!getNextCmdMsg(pScratch, outMSGID, outMSGSEV, outMSGTYPE, outMSGTEXT, outSECLVL, pSender))
        {
            pScratch->eof = 1;
            strcpy(sqlstate,"02000");
            return 0;
        }
        *outORDPOS = pScratch->current_msg;  // Ordinal is a 1's based value

        if (pSender != NULL)
        {

            snprintf(outSENDDTS, 28, "20%.2s-%.2s-%.2s-%.2s.%.2s.%.2s.%.6s",
                                pSender->Send_Date + 1,
                                pSender->Send_Date + 3,
                                pSender->Send_Date + 5,
                                pSender->Send_Time,
                                pSender->Send_Time + 2,
                                pSender->Send_Time + 4,
                                pSender->Send_Time_Microseconds);
           // Qp0zLprintf("Sent DTS: %s\n", outSENDDTS);
            copyUntil(outSENDER,  pSender->Send_User_Name, 10);

            copyUntil(outSENDPGM, pSender->Send_Program_Name,10);
            copyUntil(outSENDMOD, pSender->Send_Module_Name,10);
            copyUntil(outSENDPROC, pSender->Send_Procedure_Name,255);
            copyUntil(outTOPGM, pSender->Receive_Program_Name,10);
            copyUntil(outTOMOD, pSender->Receive_Module_Name,10);
            copyUntil(outTOPROC, pSender->Receive_Procedure_Name,255);
            if (memcmp(outSENDPGM,"*N",2)==0) outSENDPGM[0] = 0x00;
            if (memcmp(outSENDMOD,"*N",2)==0) outSENDMOD[0] = 0x00;
            if (memcmp(outSENDPROC,"*N",2)==0) outSENDPROC[0] = 0x00;

            if (memcmp(outTOPGM,"*N",2)==0) outTOPGM[0] = 0x00;
            if (memcmp(outTOMOD,"*N",2)==0) outTOMOD[0] = 0x00;
            if (memcmp(outTOPROC,"*N",2)==0) outTOPROC[0] = 0x00;

            if (pSender->Send_Statements_Available > 0)
            {
                copyUntil(outSENDSTMT, pSender->Send_Statements,4);
            }
            else
            {
                *indySENDSTMT = -1;
            }

            if (pSender->Receive_Statements_Available > 0)
            {
                copyUntil(outTOSTMT, pSender->Receive_Statements,4);
            }
            else
            {
                *indyTOSTMT = -1;
            }
        }
        else
        {
            *indySENDER  = -1;
            *indySENDPGM = -1;
            *indySENDMOD = -1;
            *indySENDPROC = -1;
            *indySENDSTMT = -1;
            *indyTOPGM = -1;
            *indyTOMOD = -1;
            *indyTOPROC = -1;
            *indyTOSTMT  = -1;
            *indySENDDTS = -1;
        }
    }

    if (*sqlOpCode == SQLUDF_TF_CLOSE)
    {
        coz_DLTOBJ(pScratch->MSGINFO, "*USRSPC");
    }
    if (*sqlOpCode == SQLUDF_TF_FINAL ||
        *sqlOpCode == SQLUDF_TF_FINAL_CRA)
    {
        // no final call code for now
    }


}  // end main

void logCtrlBlock(const Qca_PCMD_CPOP0100_t& ctrlBlock)
{
    const char lf = 0x25;

    Qp0zLprintf("[CMD_RUN] ctrlBlock.Command_Process_Type = %d%c",
                ctrlBlock.Command_Process_Type, lf);
    Qp0zLprintf("[CMD_RUN] ctrlBlock.DBCS_Data_Handling = '%c' (0x%02X)%c",
                ctrlBlock.DBCS_Data_Handling,
                (unsigned int)(unsigned char)ctrlBlock.DBCS_Data_Handling,
                lf);
    Qp0zLprintf("[CMD_RUN] ctrlBlock.Prompter_Action = '%c' (0x%02X)%c",
                ctrlBlock.Prompter_Action,
                (unsigned int)(unsigned char)ctrlBlock.Prompter_Action,
                lf);
    Qp0zLprintf("[CMD_RUN] ctrlBlock.Command_String_Syntax = '%c' (0x%02X)%c",
                ctrlBlock.Command_String_Syntax,
                (unsigned int)(unsigned char)ctrlBlock.Command_String_Syntax,
                lf);
    Qp0zLprintf("[CMD_RUN] ctrlBlock.Message_Key = [%02X %02X %02X %02X]%c",
                (unsigned int)(unsigned char)ctrlBlock.Message_Key[0],
                (unsigned int)(unsigned char)ctrlBlock.Message_Key[1],
                (unsigned int)(unsigned char)ctrlBlock.Message_Key[2],
                (unsigned int)(unsigned char)ctrlBlock.Message_Key[3],
                lf);
    Qp0zLprintf("[CMD_RUN] ctrlBlock.CCSID_Command_String = %d%c",
                ctrlBlock.CCSID_Command_String, lf);
    Qp0zLprintf("[CMD_RUN] ctrlBlock.Reserved = [%02X %02X %02X %02X %02X]%c",
                (unsigned int)(unsigned char)ctrlBlock.Reserved[0],
                (unsigned int)(unsigned char)ctrlBlock.Reserved[1],
                (unsigned int)(unsigned char)ctrlBlock.Reserved[2],
                (unsigned int)(unsigned char)ctrlBlock.Reserved[3],
                (unsigned int)(unsigned char)ctrlBlock.Reserved[4],
                lf);
}

int xlateCheckOption(const char* pProcessMode)
{
    int typeCheck = 9;  // Default to ILE CL Program CL Commands

      // Setup up type of syntax checking to perform

  if (strcmp(pProcessMode,"RUN")==0 ||  // Run CL command
      startsWith(pProcessMode,"EXEC"))  // or EXECute CL command
  {
      typeCheck = 0; // Runs a CL Command similar to QCMDEXC
  }
  else if (  // Syntax-check a CL command in a non-CL program environment
    // this is mostly a legacy feature: it mimics the QCMDCHK API syntax checking
    // which only checks commands that would be run via QCMDEXC. Therefore,
    // no embedded CL Variables or string expressions are permitted.
    // The recommended CL programming syntax checking option is *CLLE
        strcmp(pProcessMode,"CHECK")==0    ||
        strcmp(pProcessMode,"CLCHECK")==0  ||
        startsWith(pProcessMode,"CMDCH")   ||   // *CMDCHECK or *CMDCHK
        startsWith(pProcessMode,"CMDENT")  ||   // *CMDENTRY
        startsWith(pProcessMode,"CHK")     ||
        startsWith(pProcessMode,"SYNTAX")  ||
        strcmp(pProcessMode,"QCMDCHK")==0)
  {
      typeCheck = 1;     // 1=Command Entry CL Syntax check (syntax check any CL
  }
  else if (startsWith(pProcessMode,"RUNLIMIT") ||  // Run Limited User Command
           startsWith(pProcessMode,"LIMIT")    ||
           startsWith(pProcessMode,"CMDLINE"))
  {
      typeCheck = 2; // Command Line environment: RUN CL COMMAND/Limited User
  }
         // Check Limited User CL command for syntax errors only
  else if (startsWith(pProcessMode,"CHKL") ||      // *Check Limited user CL command
           startsWith(pProcessMode,"CHECKLIMIT"))

  {
      typeCheck = 3; // Command Line environment: Syntax Check Only
  }
  else if (startsWith(pProcessMode,"CLP")  ||  // *CLP
           startsWith(pProcessMode,"OPM"))     // *CLPGM
  {
      typeCheck = 4; // Syntax Check original ("OPM") CL Program statement
  }
  else if (startsWith(pProcessMode,"CMD"))   // *CMD
  {          // Command Definition statements
      typeCheck = 6;  //  (CMD, PARM, ELEM QUAL, DEP, PMTCTL)
  }
  else if (startsWith(pProcessMode,"BND")   ||  // *BND or *BIND or *BNDSRC
           startsWith(pProcessMode,"BIND"))
  {       // Binder Language CL command Syntax Check
      typeCheck = 7; // STRPGMEXP, EXPORT, ENDPGMEXP
  }
  else if (startsWith(pProcessMode,"PDM")   ||
            startsWith(pProcessMode,"USRDFN") ||
            startsWith(pProcessMode,"USERDEFN"))
  {        // Syntax Check command with PDM user-defined options
      typeCheck = 8; // e.g., CRTBNDPGM PGM(&l/&n) ...
  }
  else if (startsWith(pProcessMode,"CLLE")  ||  // *CLP
           startsWith(pProcessMode,"PGM")   ||  // *PGM
           startsWith(pProcessMode,"ILE"))      // *ILE (e.g., *ILECL)
  {
      typeCheck = 9; // Syntax Check ILE CL Program Statement (this is the default)
  }
  else if (startsWith(pProcessMode,"PMT")   ||  // *PMT
           startsWith(pProcessMode,"PROMPT"))  // *PROMPTER
  {   // 10 is prep CL command for Prompter and should not be used.
      typeCheck = 10; // it is her for completeness purposes only.
  }
  return typeCheck;
}

void rtvMsgText(char* pMsgText, int bufLen, coz_qusec& ec)
{
   char msgfile[21];
   char msgPrefix[3];

   Qus_EC_t  fc;
   memset((char*)&fc, 0x00, sizeof(fc));
   fc.Bytes_Provided = sizeof(fc);
   fc.Bytes_Available = sizeof(fc);


   if (ec.isEmpty())
   {
       return;
   }

   _CPYBYTES(msgPrefix, ec.msgid(), 2);
   msgPrefix[2] = 0x00;

   if (strcmp(msgPrefix,"CP")==0)
   {
      makeAPIObjName(msgfile,"QCPFMSG","*LIBL");
   }
   else if (strcmp(msgPrefix,"RN")==0)
   {
      makeAPIObjName(msgfile,"QRPGLEMSG","QDEVTOOLS");
   }
   else if (strcmp(msgPrefix,"HT")==0)
   {
      makeAPIObjName(msgfile,"QHTTPMSG","QHTTPSVR");
   }
   else if (strcmp(msgPrefix,"CE")==0)
   {
      makeAPIObjName(msgfile,"QCEEMSG","QSYS");
   }
   else if (strcmp(msgPrefix,"GU")==0)
   {
      makeAPIObjName(msgfile,"QGUIMSG","QSYS");
   }
   else if (strcmp(msgPrefix,"IW")==0)
   {
      makeAPIObjName(msgfile,"QIWSMSG","QSYS");
   }
      char APIFMT[9] = "RTVM0100";
      char includeMSGDATA[11];
      char fmtCTL[11];
      char msgid[8];
      char* pMsgData = ec.msgdata();
      int  msgDataLen = ec.getMsgDataLen();
      char buffer[4096];

      memset(pMsgText,0x00, bufLen);
      memset(buffer,0x00, sizeof(buffer));
      copyStrToFixed(includeMSGDATA,"*YES");
      copyStrToFixed(fmtCTL,"*NO");
      copyStrToFixed(msgid,ec.msgid(),7);

     QMHRTVM(buffer,
             sizeof(buffer),
             APIFMT,
             msgid,
             msgfile,
             pMsgData,
             msgDataLen,
             includeMSGDATA,
             fmtCTL,
             &fc);
     if (fc.Bytes_Available == 0) {
      Qmh_Rtvm_RTVM0100_t* pRtnMsg = (Qmh_Rtvm_RTVM0100_t*) buffer;
      _CPYBYTES(pMsgText, buffer + sizeof(Qmh_Rtvm_RTVM0100_t), pRtnMsg->Length_Message_Returned);
     }
     return;
}

// This function grabs each command generated by the syntax checker
// Note that normally, only the first one (which is usually the last
// syntax error, is returned.
int getNextCmdMsg(scratch_t* pScratch, char* msgid, int* msgsev, char* msgtype, char* msgtext, char* seclvl, Qmh_Rcvpm_Sender_t*& pSender)
{

  char MSGTYPE[] = "*ANY      ";
  char MSGQ[11]  = "*         ";
  char MSGKEY[4] = {0};   // initialized to all x'00'
  const char blanks7[] = "       ";

  int  CALLSTACK = 0;
  int  WAIT = 0;
  coz_qusec ec;

  Qmh_Rcvpm_RCVM0300_t* pMsgInfo = (Qmh_Rcvpm_RCVM0300_t*) coz_getPtrUsrSpace(pScratch->MSGINFO);
  char* msgBuffer = (char*) pMsgInfo;

  memset((char*)pMsgInfo, 0x00, sizeof(1000));

    if (pScratch->msgcount <= 0) return 0;
    if (pScratch->current_msg >= pScratch->msgcount) return 0;

    int m = pScratch->current_msg++;
    if (m >= MAX_MSGKEY_COUNT)  // MAX_MSGKEY_COUNT - 1 is the array 'index' max to use
    {
      return 0;
    }

    _CPYBYTES(MSGKEY,pScratch->msgkey[m], 4);  // Update to this msgkey

    char callStackEntry[20];
    char callStackEntry_Type[10];
    int returningCCSID = 0; // Return MSGTEXT and MSGDATA in Job CCSID
    int callStackEntry_Len = 10;
    copyStrToFixed(callStackEntry, "*NONE", 10);
    copyStrToFixed(callStackEntry + 10, "*NONE", 10);
    copyStrToFixed(callStackEntry_Type, "*CHAR", 10);

    QMHRCVPM((char*)pMsgInfo, coz_MAXMEM15M, QMH_FMT_RCVM0300,
             MSGQ, CALLSTACK,
             MSGTYPE,
             MSGKEY,
             WAIT,
             QMH_MSGACT_OLD, &ec,
             callStackEntry_Len, callStackEntry, callStackEntry_Type,
             returningCCSID);

  if (ec.hasNoError() && pMsgInfo->Bytes_Returned > 8)
  {
      _CPYBYTES(msgid, pMsgInfo->Message_Id,7);
      *msgsev = pMsgInfo->Message_Severity;
      getMsgType(msgtype, pMsgInfo->Message_Type);

      int off_msgdata = sizeof(Qmh_Rcvpm_RCVM0300_t);  // msgdata and/or impromptu message text
      int off_msgtext = off_msgdata + pMsgInfo->Length_Data_Returned;
      int off_seclvl  = off_msgtext + pMsgInfo->Length_Message_Returned;
      int off_sender  = off_seclvl  + pMsgInfo->Length_Help_Returned;

      if (memcmp(msgid,blanks7,7) == 0) // ImpromptU message
      {
         _CPYBYTES(msgtext, msgBuffer + off_msgdata, std::min<int>(MAX_MSGTEXT_LEN,pMsgInfo->Length_Data_Returned));
         msgtext[std::min<int>(MAX_MSGTEXT_LEN,pMsgInfo->Length_Data_Returned)] = 0x00;
      }
      if (pMsgInfo->Length_Message_Returned > 0)  // Regular message
      {
         _CPYBYTES(msgtext, msgBuffer + off_msgtext, std::min<int>(MAX_MSGTEXT_LEN,pMsgInfo->Length_Message_Returned));
         msgtext[std::min<int>(MAX_MSGTEXT_LEN,pMsgInfo->Length_Message_Returned)] = 0x00;
      }
      if (pMsgInfo->Length_Help_Returned > 0)  // Second Level Help text
      {
        // 2nd Level (SECLVL) message text. Also referred to as "Message Help"
        _CPYBYTES(seclvl, msgBuffer + off_seclvl, std::min<int>(MAX_SECLVL_LEN,pMsgInfo->Length_Help_Returned));
        seclvl[std::min<int>(MAX_SECLVL_LEN,pMsgInfo->Length_Help_Returned)] = 0x00;
      }
      // Qp0zLprintf("Sender Offset: %d Length: %d Avail: %d\n",
      //                          off_sender,
      //                          pMsgInfo->Length_Send_Returned,
      //                          pMsgInfo->Length_Send_Available);

      if (pMsgInfo->Length_Send_Returned > 0)  // Sender Info
      {
          pSender = (Qmh_Rcvpm_Sender_t*)(msgBuffer + off_sender);
      }
      return 1;
  }
  return 0;
}



/* ============================================= */
/* coz_copyUntil                                 */
/* Copy s to t (null-terminated), stopping at   */
/* maxLen, NUL, or any char in stopAt.           */
/* ============================================= */
int copyUntil(
                char*       t,
                const char* s,
                int         maxLen,
                const char* stopAt,
                bool        bTrim)
{
    int bStop  = 0;
    int rtnLen = 0;
    int i      = 0;
    if (t == NULL || s == NULL) return 0;
#pragma exception_handler(coz_cu_exc,\
    0, 0,\
    _C2_MH_ESCAPE | _C2_MH_FUNCTION_CHECK,\
    _CTLA_HANDLE)
    memset(t, ' ', maxLen);
    while (s[i] != 0x00 && i < maxLen) {
        if (stopAt != NULL) {
            size_t j;
            for (j = 0; j < strlen(stopAt); j++) {
                if (s[i] == stopAt[j]) {
                    bStop = 1;
                }
            }
        }
        if (bStop) break;
        t[i] = s[i];
        i++;
    }
    if (bTrim) {
        t[i] = 0x00;
        if (i > 0)
            t[::triml(t, ' ')] = 0x00;
        rtnLen = (int)strlen(t);
    } else {
        rtnLen = i;
    }
#pragma disable_handler
    return rtnLen;
coz_cu_exc:;
    return rtnLen;
}

int make3PartJobName(char* qualJob, const char* jobNbr, const char* jobUser, const char* jobName)
{
    char jUser[11];
    char jName[11];
    char jNbr[7];
    copyUntil(jUser, jobUser, 10);
    copyUntil(jName, jobName, 10);
    copyUntil(jNbr, jobNbr, 6);
    sprintf(qualJob, "%s/%s/%s", jNbr, jUser, jName);
    return strlen(qualJob);
}

// If errors are returned, then save all the message keys.
inline int collectAllMsgKeys(scratch_t* pScratch)
{
  char APIFMT[] = "RCVM0100";
  char MSGKEY[4];
  char MSGTYPE[11] = "*NXTJLMSG ";
  char MSGQ[11]    = "*         ";
  int  CALLSTACK   = 0;   // Must be 1 or it doesn't work (i.e., 0 is wrong)
  int  WAIT = 0;

  char msgBuffer[4096];

  Qmh_Rcvpm_RCVM0100_t* pMsgInfo = (Qmh_Rcvpm_RCVM0100_t*)msgBuffer;
  coz_qusec ec;


  pScratch->msgcount = 0;
  memset(pScratch->msgkey[0],0x00, sizeof(MSGKEY));
  _CPYBYTES(MSGKEY,pScratch->msgkey[0],sizeof(MSGKEY));

  do {
    int m = (pScratch->msgcount > 0) ? pScratch->msgcount-1 : 0;
    if (pScratch->msgcount > 0)
    {
        _CPYBYTES(MSGKEY,pScratch->msgkey[m], 4);  // Update to next msgkey
    }
    else
    {
        _CPYBYTES(MSGKEY,pScratch->RQSMSGKEY, 4);  // Update to next msgkey
    }

    memset(msgBuffer, 0x00, sizeof(msgBuffer));

    QMHRCVPM(msgBuffer, sizeof(msgBuffer), QMH_FMT_RCVM0100,
             MSGQ, CALLSTACK,
             MSGTYPE,
             MSGKEY,
             WAIT,
             QMH_MSGACT_SAME, &ec);
    if (ec.hasNoError() && pMsgInfo->Bytes_Returned > 8)
    {   // Save the msgkey
      _CPYBYTES(pScratch->msgkey[pScratch->msgcount], pMsgInfo->Message_Key, 4);
      pScratch->msgcount++;
    }
  } while (ec.hasNoError() && pMsgInfo->Bytes_Returned > 8 && pScratch->msgcount < MAX_MSGKEY_COUNT);
  // Qp0zLprintf("[CMD_RUN] Added %d msgkeys\n", pScratch->msgcount);
  return pScratch->msgcount;
}



/* ============================================= */
/* coz_getNextParmIf                             */
/* Advance parameter counter and return argv[n]. */
/* If ioFlag>0, memset output parm to 0x00.      */
/* ============================================= */
inline char* coz_getNextParmIf(
    int&  pC,
    int&  argc,
    char** argv,
    int    ioFlag)
{
    char* pRtn = NULL;
    if (argc > pC + 1) {
        pRtn = argv[++pC];
        if (ioFlag > 0)
            memset(pRtn, 0x00, ioFlag);
    }
    return pRtn;
}

int getMsgType(char* msgType, const char* msgtypeID)
{
    int typeCode = 0;

    // API returns a 2-byte character code (char[2]); convert it to an int.
    if (msgtypeID != NULL &&
        std::isdigit((unsigned char)msgtypeID[0]) &&
        std::isdigit((unsigned char)msgtypeID[1]))
    {
        typeCode = ((msgtypeID[0] - '0') * 10) + (msgtypeID[1] - '0');
    }

    // Default for unknown/future message types.
    strcpy(msgType,"*UNKNOWN");

    if (typeCode == 1)
    {
        strcpy(msgType,"*COMP");
    }
    else if (typeCode == 2)
    {
        strcpy(msgType,"*DIAG");
    }
    else if (typeCode == 4)
    {
        strcpy(msgType,"*INFO");
    }
    else if (typeCode == 5)
    {
        strcpy(msgType,"*INQ");
    }
    else if (typeCode == 6)
    {
        strcpy(msgType,"*SENDER");
    }
    else if (typeCode == 8)
    {
        strcpy(msgType,"*RQS");
    }
    else if (typeCode == 14)
    {
        strcpy(msgType,"*NOTIFY");
    }
    else if (typeCode == 15)
    {
        strcpy(msgType,"*ESCAPE");
    }

    return typeCode;
}


/* ============================================= */
/* Parse optional label prefix and copy command. */
/* Accepts: "label: CMD ..." or "CMD ..."       */
/* Returns pointer to command token in inText.   */
/* ============================================= */
char* extractCLCmdName(const char *inText, char *outCmd, int outCmdSize)
{
    const unsigned char *p;
    const unsigned char *q;
    const unsigned char *colon = NULL;
    const unsigned char *cmdStart;
    int len;

    if (outCmd == NULL || outCmdSize <= 0)
    {
        return NULL;
    }

    outCmd[0] = 0x00;

    if (inText == NULL)
    {
        return NULL;
    }

    p = (const unsigned char *)inText;
    while (*p != 0x00 && std::isspace(*p))
    {
        ++p;
    }
    if (*p == 0x00)
    {
        return NULL;
    }

    q = p;
    while (*q != 0x00)
    {
        if (std::isspace(*q))
        {
            break;
        }
        if (*q == ':')
        {
            colon = q;
            break;
        }
        ++q;
    }

    if (colon != NULL)
    {
        cmdStart = colon + 1;
        while (*cmdStart != 0x00 && std::isspace(*cmdStart))
        {
            ++cmdStart;
        }
    }
    else
    {
        cmdStart = p;
    }

    if (*cmdStart == 0x00)
    {
        return NULL;
    }

    q = cmdStart;
    while (*q != 0x00 && !std::isspace(*q))
    {
        ++q;
    }

    len = (int)(q - cmdStart);
    if (len >= outCmdSize)
    {
        len = outCmdSize - 1;
    }

    if (len > 0)
    {
        memcpy(outCmd, cmdStart, len);
    }
    outCmd[len] = 0x00;

    return (char *)cmdStart;
}

int isProhibitedCmd(const char* pCmd,  char* pRtnCmdName, int rtnCmdNameBufferSize)
{
    // Security gate: block selected high-impact CL commands from this UDTF
    // even when a caller has authority to run them interactively.
    memset(pRtnCmdName, 0x00, rtnCmdNameBufferSize);

    // Parse only the command token from input text (supports optional labels,
    // such as "label: CPYF TOFILE(...)").
    const char* pCmdString = extractCLCmdName(pCmd, pRtnCmdName, rtnCmdNameBufferSize);

    // Maintain prohibited command names in one list for easy policy updates.
    static const char *secureCmd[] = {"PWRDWNSYS", "ENDSYS", "ENDTCPSVR"};

    if (pCmdString == NULL || pRtnCmdName[0] == 0x00)
    {
        return 0;
    }

    // Compare case-insensitively by normalizing the extracted token to uppercase.
    makeUpper(pRtnCmdName);

    for (size_t i = 0; i < (sizeof(secureCmd) / sizeof(secureCmd[0])); ++i)
    {
        if (strcmp(pRtnCmdName, secureCmd[i]) == 0)
        {
            return 1;
        }
    }

    return 0;
}

int sndMsg(const char *pMsgID, const char *pMsgfile, const char *pMsgFLib)
{
    int ctlInv = 1;
    char msgfile[20];
    char msgKey[4];
    char msgData[64];
    qusec_t ec;

    memset((char *)msgfile, ' ', sizeof(msgfile));
    memset((char *)msgKey, ' ', sizeof(msgKey));
    memset((char *)msgData, 0x00, sizeof(msgData));
    makeAPIObjName(msgfile, pMsgfile, pMsgFLib);
    memset((char *)&ec, 0x00, sizeof(ec));
    ec.Bytes_Provided = sizeof(ec);
    QMHSNDPM((char*)pMsgID, msgfile, (char *)msgData, 0,
             QMH_MSGT_DIAG, QMH_INV_MSG_Q_CURRENT, ctlInv, msgKey, &ec);
    return 0;
}

int sndrcvRQS(const char* pCmd, int cmdLen, scratch_t* pScratch)
{
    int             ctlInv = 0;
    char            msgfile[20];
    char            replyMSGQ[20];
    char            msgID[7];
    char            msgType[11];
    char            toPgmq[10];
    char            msgKey[4];
    char            msgInfo[1024];
    qusec_t         ec;

    memset((char*)msgID,' ',sizeof(msgID));
    memset((char*)msgfile,' ',sizeof(msgfile));
    memset((char*)msgType,' ',sizeof(msgType));
    memset((char*)toPgmq,' ',sizeof(toPgmq));
    memset((char*)msgKey,' ',sizeof(msgKey));

    _CPYBYTES(msgType,QMH_MSGT_RQS,sizeof(QMH_MSGT_RQS));
    _CPYBYTES(toPgmq,QMH_INV_MSG_Q_EXT,sizeof(QMH_INV_MSG_Q_EXT));
    ctlInv = 1;

    // If requested, log the CL Command as a *RQS message, using SendPgmMsg.
    memset((char*)&ec,0x00,sizeof(ec));
    ec.Bytes_Provided = sizeof(ec);
    QMHSNDPM(msgID, msgfile, (char*) pCmd, cmdLen,
            msgType, toPgmq, ctlInv, msgKey, &ec);
    memset((char*)msgInfo, 0x00, sizeof(msgInfo));
    _CPYBYTES(pScratch->RQSMSGKEY, msgKey, sizeof(msgKey));

    QMHRCVPM(msgInfo, sizeof(msgInfo), QMH_FMT_RCVM0100,
                    toPgmq, ctlInv, msgType, msgKey, 0,  // wait time is zero
                    QMH_MSGACT_OLD, &ec);
    return 0;
}



inline char *coz_getPtrUsrSpace(const char *p2PartUsrSpaceName)
{
    void *pUS = NULL;
    qusec_t ec;
    memset(&ec, 0x00, sizeof(ec));
    ec.Bytes_Provided = sizeof(ec);

    QUSPTRUS((char *)p2PartUsrSpaceName,
             &pUS, &ec);
    if (ec.Bytes_Returned == 0 && pUS != NULL)
    {
        return (char *)pUS;
    }
    return NULL;
}

/* ============================================= */
/* coz_TEMP_USRSPACE                             */
/* Create a temporary *USRSPC in QTEMP.          */
/* Returns a pointer to user-space.              */
/* stores 20-char API name in rtnUSName[20].     */
/* ============================================= */
inline char *coz_TEMP_USRSPACE(
    char *rtnUSName,
    const char *objAttr,
    int initSize)
{
    char qualName[21];
    char extAttr[11];
    char pubAut[11];
    char text[51];
    char repl[11];
    char domain[11];
    char initVal = 0x00;
    char *pUS = NULL;
    qusec_t ec;
    std::string nm;
    size_t pos = 0;
    memset(qualName, ' ', 20);
    qualName[20] = 0x00;
    nm = tmpnam(NULL);
    pos = nm.find_last_of("/\\");
    if (pos != std::string::npos)
        nm.erase(0, pos + 1);
    if (nm.length() > 10)
        nm.resize(10);

            // "Safe" - Make 2-part API qualified name buffer
    makeAPIObjName(qualName, nm.c_str(), "QTEMP");

    makeUpper(qualName, 20);

    copyPad(extAttr, objAttr, 10);
    copyPad(pubAut, "*LIBCRTAUT", 10);
    copyPad(text,
            "SPOOLDATA UDTF Temp Space", 50);
    copyPad(repl, "*NO", 10);
    copyPad(domain, "*DEFAULT", 10);

    memset(&ec, 0x00, sizeof(ec));
    ec.Bytes_Provided = sizeof(ec);

    QUSCRTUS(qualName, extAttr, initSize,
             &initVal, pubAut, text,
             repl, &ec, domain);
    if (ec.Bytes_Returned == 0)
    {
        RMVMSG("*COMP",NULL);   // Swallow the Ownership has changed msg

        /* Enable auto-extend so the space grows   */
        /* automatically when APIs write past the  */
        /* initial size (e.g. QDBRTVFD).           */
        /* key=3 is AutoExtend; key=1=size,        */
        /* key=2=InitChar, key=4=TransferSize.     */
        typedef _Packed struct
        {
            int key;
            int dataLen;
            union
            {
                int size;
                int transferSize;
                char autoExtend;
                char initValue;
            };
        } coz_spaceKey_t;
        typedef _Packed struct
        {
            int count;
            coz_spaceKey_t attr[1];
        } coz_spaceAttr_t;
        coz_spaceAttr_t spaceAttr;
        spaceAttr.count = 1;
        spaceAttr.attr[0].key = 3;
        spaceAttr.attr[0].dataLen = 1;
        spaceAttr.attr[0].autoExtend = '1';
        char rtnLib[10];
        memset(rtnLib, ' ', sizeof(rtnLib));

        memset(&ec, 0x00, sizeof(ec));
        ec.Bytes_Provided = sizeof(ec);

        QUSCUSAT(rtnLib, qualName, &spaceAttr, &ec);
        /* Non-fatal if QUSCUSAT fails \Z space     */
        /* will still work, just won't auto-grow.  */
        memset(&ec, 0x00, sizeof(ec));
        ec.Bytes_Provided = sizeof(ec);
        QUSPTRUS(qualName, (void **)&pUS, &ec);
    }
    if (pUS != NULL && rtnUSName != NULL)
        _CPYBYTES(rtnUSName, qualName, 20);
    return pUS;
}


/* ============================================= */
/* coz_DLTOBJ                                    */
/* Delete an IBM i object via QLIDLTO API.       */
/* ============================================= */
void coz_DLTOBJ(
    const char *qualObjName,
    const char *objType,
    const char *ASPName)
{
    char szObjType[11];
    char szASP[11];
    char rmvMsg[1] = {'1'};
    qusec_t ec;
    if (qualObjName == NULL ||
        qualObjName[0] == ' ' ||
        qualObjName[0] == 0x00)
        return;
    copyPad(szObjType, objType, 10);
    copyPad(szASP, ASPName, 10);
    memset(&ec, 0x00, sizeof(ec));
    QLIDLTO((char *)qualObjName,
            szObjType, szASP,
            rmvMsg, &ec);
}

// inline int RMVMSG(const char* msgtype, const char* msgkey=NULL);
inline int RMVMSG(const char* msgtype, const char* msgkey)
{
     qusec_t      ec;

     int             callStackCounter = 0;
     char            callStack[10];
     char            msgType[11];
     char            msgKey[4];
     Qmh_Rcvpm_RCVM0100_t   msgInfo;

     memset((char*)callStack,' ',sizeof(callStack));
     memset((char*)msgType,' ',  sizeof(msgType));
     memset((char*)msgKey,0x00,  sizeof(msgKey));
     memset((char*)&msgInfo, 0x00, sizeof(msgInfo));

     callStack[0] ='*';
     callStackCounter = 0;
     if (msgtype != NULL && strlen(msgtype) > 4)
     {
       _CPYBYTES(msgType,msgtype,strlen(msgtype));
     }
     {
       _CPYBYTES(msgType,"*PRVJLMSG ",10);
     }
     if (msgkey != NULL)
     {
       _CPYBYTES(msgKey,msgkey,4);
     }

     QMHRCVPM(&msgInfo, sizeof(msgInfo), QMH_FMT_RCVM0100,
              callStack, callStackCounter, msgType, msgKey, 0,  // wait time is zero
              QMH_MSGACT_SAME, &ec);

     if (ec.Bytes_Returned  > 0)
     {
        return 0;
     }
     if (memcmp(msgInfo.Message_Id,"CPC2206",7)==0)  // Ownership change message?
     {
        QMHRMVPM(callStack, callStackCounter,msgInfo.Message_Key,"*BYKEY    ",&ec);
     }
     return 1;
}


#pragma datamodel(pop)

`;
}
