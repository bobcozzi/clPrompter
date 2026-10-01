/**
 * Embedded source for CMD_CHECK.CPP.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/CMD_CHECK/CMD_CHECK.CPP
 * Stored as plain text (no base64 encoding).
 */
export function getCmdCheckCPPSrc(): string {
    return String.raw`// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 1996-2026 by R. Cozzi, Jr.


  // @author BobCozzi

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
#include <QMHRTVM.h>

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
#define outShort(_v) \
           short *out##_v = \
           short *)coz_getNextParmIf(p, argc, argv, 2)

#define outInt(_v)   \
           int   *out##_v = \
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

inline void copyPad(char* dest, const char* src, int maxLen = 10)
{
    memset(dest, ' ', maxLen);
    _CPYBYTES(dest, src, maxLen);
}

inline void copyFromStr(char* dest, const char* src, int maxLen = 10)
{
    memset(dest, ' ', maxLen);
    _CPYBYTES(dest, src, std::min<int>(strlen(src), maxLen));
}


#define makeAPIObjName(_out, _obj, _lib) \
 memset(_out, ' ', 10); \
 _CPYBYTES(_out, _obj, strlen(_obj)); \
 memset(_out+10, ' ', 10); \
 _CPYBYTES(_out+10, _lib, strlen(_lib))



#define MAX_MSG_ENTRIES 16  // Limit to 16 syntax error message (rarely more tha
#define MAXMSGTEXT_LEN 512  // Limit message text to the first 1/2k of data

typedef struct tagMsgEntry_t {
    char msgid[7];
    char msgtext[MAXMSGTEXT_LEN+1];
} msgentry_t;


typedef _Packed struct tagScratch
{
    int  len;  // scratch pad length as set by the SCRATCHPAD kwd in the UDTF
    char pgmName[11];
    char libName[11];
    int eof;
    int syntaxOption;  // Check or Run QCAPCMD runtype control option
    int msgcount;
    int current_msg;
    char msgkey[100][4];
} scratch_t;


int getNextCmdMsg(scratch_t* pScratch, char* msgid, int* msgsev, char* msgtext);
inline int saveAllMsgKeys(scratch_t* pScratch);
int xlateCheckOption(const char* pCheckOption);

    // Prototype for retrieve Message text
void rtvMsgText(char* pMsgText, int bufLen, coz_qusec& ec);


int main(int argc, char *argv[])
{
     /**********************************************************/
     /* Syntax Check CL Commands via an SQL Fuction            */
     /**********************************************************/

     int p = 0;

     //////////////////////////////////////////////
     //  INPUT Parameters
     //////////////////////////////////////////////
     inChar(CMD);
     inChar(CHECKOPT);

     //////////////////////////////////////////////
     //  OUTPUT Parameters
     //////////////////////////////////////////////
     outChar(MSGID);
     outInt(MSGSEV);
     outChar(MSGTEXT);   // Future objective to create full resulting message te
     outChar(CMD);       // Output reformatted command for pre-prompting OPTION(

     //////////////////////////////////////////////
     //  Input Indicator Fields
     //////////////////////////////////////////////
     inIndy(CMD);
     inIndy(CHECKOPT);
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
    outIndy(MSGID);   // set to 0 by the macro
    outIndy(MSGSEV);
    outIndy(MSGTEXT);    // set to 0 by the macro
    outIndy(CMD);        // set to 0 by the macro

     ////////////////////////////////////////////////////////////
     //  SQL specific parameters
     ////////////////////////////////////////////////////////////
     char *sqlstate     = (char *)coz_getNextParmIf(p, argc, argv);
     char *funcName     = (char *)coz_getNextParmIf(p, argc, argv);
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
           int len = pScratch->len; // save scratchpad length
           memset(pScratch,0x00, sizeof(scratchPad));
           pScratch->len = len; // restore scratchpad length


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

     const int MAXCMD_LEN = 6000;           // Min updated CMD string area
     const int MINCMD_BUFLEN = 1024;
     int cmdLen = strlen(inCMD);   // Input CMD string length
     while (cmdLen > 0 && inCMD[cmdLen-1] == ' ') --cmdLen;

      // Calculate length for updated CMD string workspace
     int  rtnUpdatedCmdLen = 0;
     int  returnedCmdBufferLen = MAXCMD_LEN;
     char returnedCmdString[MAXCMD_LEN];
     char* pRtnCmd = returnedCmdString;

     ctrlBlock.Command_Process_Type = 3;  // DFT(Command Entry Syntax checking)
     if (*indyInCHECKOPT >= 0 && strlen(inCHECKOPT) > 0)
     {
        while (*inCHECKOPT == ' ' || *inCHECKOPT == '*') {
               ++inCHECKOPT;
        }
        char cmdCheckOption[64];
        strcpy(cmdCheckOption, inCHECKOPT);
        makeUpper(cmdCheckOption);

        pScratch->syntaxOption = xlateCheckOption(cmdCheckOption);

        ctrlBlock.Command_Process_Type = pScratch->syntaxOption;

      }
      const char lf = 0x25;
      Qp0zLprintf("[CMD_CHECK] Using Option %s:%d %c",
                   inCHECKOPT,
                   ctrlBlock.Command_Process_Type,
                   lf);


#pragma exception_handler(MONMSG, 0, 0, _C2_MH_ESCAPE | _C2_MH_FUNCTION_CHECK,\
                          _CTLA_HANDLE )

      ec.init();
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

MONMSG:
      if (*indyCMD >= 0 && ctrlBlock.Command_Process_Type == 10)
      {
         returnedCmdString[rtnUpdatedCmdLen] = 0x00;
         strcpy(outCMD, returnedCmdString);
      }

#pragma disable_handler
CONTINUE:
      if (ec.hasNoError() && pScratch->syntaxOption != 0)
      {
        pScratch->eof = 1;
        strcpy(sqlstate,"02000");
        return 0;
      }
      // Fetch and save the first message key into the scratch pad
      saveAllMsgKeys(pScratch);

    }  // end SQLUDF_TF_OPEN

    if (pScratch->eof != 0) {
      strcpy(sqlstate,"02000");
    }



      // SQLUDF_TF_FETCH  - F E T C H
    if (*sqlOpCode == SQLUDF_TF_FETCH)
    {
         *indyCMD =  -1;
         outCMD[0] = 0x00;
         char msgid[7];
         char msgtext[4096];

        // Qp0zLprintf("[CMD_CHECK] FETCH detects %d msgkeys\n", pScratch->msgcount);
        if (!getNextCmdMsg(pScratch, outMSGID, outMSGSEV, outMSGTEXT))
        {
            pScratch->eof = 1;
            strcpy(sqlstate,"02000");
            return 0;
        }
    }

}  // end main

int xlateCheckOption(const char* pCheckOption)
{
    int typeCheck = 3;  // Default to non-CL Program CL Commands (i.e., Command

      // Setup up type of syntax checking to perform
      // RC: Change this first compare from startsWith to strcmp
  if (startsWith(pCheckOption,"RUN") ||  // Run Limited User Command
      startsWith(pCheckOption,"QCMDEXC"))
  {
      typeCheck = 0; // Run CL Command similar to QCMDEXC
  }
  else if (
        strcmp(pCheckOption,"CHECK")==0  ||
        strcmp(pCheckOption,"CLCHECK")==0  ||
        strcmp(pCheckOption,"CL")==0  ||   // *CL is now the same as QCMDCHK
        strcmp(pCheckOption,"CHK")==0    ||
        strcmp(pCheckOption,"SYNTAX")==0  ||
        strcmp(pCheckOption,"QCMDCHK")==0)
  {
      typeCheck = 1;     // 1=Command Entry CL Syntax check (syntax check any CL
  }
  else if (startsWith(pCheckOption,"RUNLIMIT") ||  // Run Limited User Command
           startsWith(pCheckOption,"CMDLINE"))     // Similar to Command-Line Wi
  {
      typeCheck = 2; // Command Line environment: RUN CL COMMAND/Limited User
  }
         // DEFAULT CHECKOPT
  else if (startsWith(pCheckOption,"CHKLIMIT") ||  // Syntax Check Limited User
           startsWith(pCheckOption,"CHECKLIMIT"))  // similar to Command-Line Wi

  {
      typeCheck = 3; // Command Line environment: Syntax Check Only
  }
  else if (startsWith(pCheckOption,"CLP")   ||  // *CLP
           startsWith(pCheckOption,"OPM")   ||  // *CLPGM
           startsWith(pCheckOption,"CLPGM"))    // *PGM
  {
      typeCheck = 4; // Syntax Check CL Program statement
  }
  else if (startsWith(pCheckOption,"CMD"))   // *CMD
  {
      typeCheck = 6;  // Command definition statements
  }
  else if (startsWith(pCheckOption,"BND")   ||  // *CLP
           startsWith(pCheckOption,"BIND"))      // *PGM
  {
      typeCheck = 7; // Binder Language CL command Syntax Check
  }
  else if (startsWith(pCheckOption,"PDM")   ||  // *CLP
            startsWith(pCheckOption,"USRDFN") ||  // *CLPGM
            startsWith(pCheckOption,"USERDEFN"))      // *PGM
  {
      typeCheck = 8; // Syntax Check CL Program statement
  }
  else if (startsWith(pCheckOption,"CLLE")   ||  // *CLP
           startsWith(pCheckOption,"ILECL") ||  // *CLPGM
           startsWith(pCheckOption,"ILE"))      // *PGM  or *ILEPGM or *ILECLPGM
  {
      typeCheck = 9; // Syntax Check IL CL Program statement
  }
  else if (startsWith(pCheckOption,"PMT")   ||  // *PMT
           startsWith(pCheckOption,"PROMPT"))  // *PROMPTER
  {   // 10 is prep for prompting.
      typeCheck = 10; // Syntax Check CL Program statement
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
      copyFromStr(includeMSGDATA,"*YES");
      copyFromStr(fmtCTL,"*NO");
      copyPad(msgid,ec.msgid(),7);

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
int getNextCmdMsg(scratch_t* pScratch, char* msgid, int* msgsev, char* msgtext)
{
  char APIFMT[]  = "RCVM0200";
  char MSGTYPE[] = "*ANY      ";
  char MSGQ[11]  = "*         ";
  int  CALLSTACK = 0;
  char MSGKEY[4];
  int  WAIT = 0;
  char msgBuffer[4096];
  Qmh_Rcvpm_RCVM0200_t* pMsgInfo = (Qmh_Rcvpm_RCVM0200_t*)msgBuffer;
  coz_qusec ec;

  memset(msgBuffer, 0x00, sizeof(msgBuffer));

  if (pScratch->msgcount <= 0) return 0;
  if (pScratch->current_msg > pScratch->msgcount) return 0;

  int m = pScratch->current_msg++;
  _CPYBYTES(MSGKEY,pScratch->msgkey[m], 4);  // Update to this msgkey

  QMHRCVPM(msgBuffer, sizeof(msgBuffer), QMH_FMT_RCVM0200,
           MSGQ, CALLSTACK,
           MSGTYPE,
           MSGKEY,
           WAIT,
           QMH_MSGACT_OLD, &ec);

  if (ec.hasNoError() && pMsgInfo->Bytes_Returned > 8)
  {
      _CPYBYTES(msgid, pMsgInfo->Message_Id,7);
      *msgsev = pMsgInfo->Message_Severity;
      int mOffset = pMsgInfo->Length_Data_Returned;
      int maxCopyLen = std::min<int>(512,pMsgInfo->Length_Message_Returned);
      _CPYBYTES(msgtext, msgBuffer + sizeof(Qmh_Rcvpm_RCVM0200_t) + mOffset, maxCopyLen);
      return 1;
  }
  return 0;
}

// If errors are returned, then save all the message keys.
inline int saveAllMsgKeys(scratch_t* pScratch)
{
  char APIFMT[] = "RCVM0200";
  char MSGKEY[4];
  char MSGTYPE[11] = "*NEXT     ";
  char MSGQ[11]    = "*         ";
  int  CALLSTACK   = 1;   // Must be 1 or it doesn't work (i.e., 0 is wrong)
  int  WAIT = 0;

  char msgBuffer[4096];

  Qmh_Rcvpm_RCVM0200_t* pMsgInfo = (Qmh_Rcvpm_RCVM0200_t*)msgBuffer;
  coz_qusec ec;


  pScratch->msgcount = 0;
  memset(pScratch->msgkey[0],0x00, 4);

  // Qp0zLprintf("[CMD_CHECK] Loading msgkeys...\n");

  int m;
  do
  {
    m = (pScratch->msgcount > 0) ? pScratch->msgcount - 1 : 0;
    _CPYBYTES(MSGKEY,pScratch->msgkey[m], 4);  // Update to next msgkey
    memset(msgBuffer, 0x00, sizeof(msgBuffer));

    QMHRCVPM(msgBuffer, sizeof(msgBuffer), QMH_FMT_RCVM0200,
             MSGQ, CALLSTACK,
             MSGTYPE,
             MSGKEY,
             WAIT,
             QMH_MSGACT_OLD, &ec);
    if (ec.hasNoError() && pMsgInfo->Bytes_Returned > 8)
    {
      _CPYBYTES(pScratch->msgkey[pScratch->msgcount], pMsgInfo->Message_Key, 4);  // Update to next msgkey
      pScratch->msgcount++;
    }
  } while (ec.hasNoError() && pMsgInfo->Bytes_Returned > 8);
  // Qp0zLprintf("[CMD_CHECK] Added %d msgkeys\n", pScratch->msgcount);
  return 0;
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


#pragma datamodel(pop)

`;
}
