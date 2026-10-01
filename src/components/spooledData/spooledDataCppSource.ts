/**
 * Embedded source for SPOOL_DATA.CPP.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/SPOOLED_DATA/SPOOL_DATA.CPP
 * Stored as plain text (no base64 encoding).
 */
export function getSpooledDataCPPSrc(): string {
    return String.raw`
#define __STDC_WANT_DEC_FP__
#include <stdlib.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>

#include <errno.h>
#include <ctype.h>
#include <sys/types.h>
#include <inttypes.h>
#include <decimal.h>

#include <except.h>
#include <signal.h>

#include <QSPRILSP.h>
#include <QUSRSPLA.h>
#include <QSPOPNSP.h>
#include <QSPGETSP.h>
#include <QSPCLOSP.h>

#include <sqltoolsrc/h/cozutils>    // Shared SQL Tools Utilities include file

#include <SQL.h>
#include <SQLUDF.h>

#include <iostream>
#include <fstream>
#include <sstream>
#include <algorithm>
#include <string>

#define MAXLINELEN 2048

typedef _Packed struct tagScratch
{
    int  length;
    int  hSplf;
    char DEVTYPE;
    char QUSRSPACE[20];

    char splfname[10];
    char splfnbr[6];
    int  splnbr;

    int BUFFER_COUNT;
    int BUFFER_OFFSET;
    int BUFFER_SIZE;
    int BUFFER_LEN;
    int END_OF_BUFFERS;

    int START_PAGE;
    int START_LINE;

    int CURPAGENBR;
    int CURLINENBR_ONPAGE;

    int BUFFER_RQS;
    int BUFFERS_READ;
    int NEXTRECORD;
    int NEXTPAGE;

    int eof;
    int counter;

    int toUpper;
    int toLower;
    int trimLeft;
    int trimRight;
    int omitBlanks;
    int dltSplf;
    int bStarted;
    char prodLib[11];
    char splfEOFAction[11];
    char job[29];
    char ruler[512];
    Qsp_SPFRH_t    BUFFER_HDR;
    Qus_SPLA0200_t splfAttr;
    char dltSplfCmd[256];
} scratch_t;


typedef struct tagUsrspaceLen
{
    int len;
    char *data;
} userSpaceLen_t;

typedef _Packed struct tagJobName
{
    union
    {
        char Job_Name[10];
        char name[10];
    };
    union
    {
        char Job_User[10];
        char user[10];
    };
    union
    {
        char Job_Number[6];
        char nbr[6];
    };
} jobName_t;

inline int findFirstNotOf(
    const char *pSearchMe, int ch, int len)
{
    if (len <= 0)
        return len;

    int limit;
    int i = 0;

    if (len > MAXLINELEN)
        limit = MAXLINELEN;
    else
        limit = len;

    for (i = 0; i < limit; i++)
    {
        if (pSearchMe[i] != ch)
            return i;
    }
    return len;
}

int readAFPLine(char* ptr_To_SPOOL_FILE_BUFFER,
                int   buffer_size,
                int&  offset_within_Buffer,
                char* outputBuffer,
                int   obLen,
                spBufferStatus_t& spStat
               );

/**********************************************************/
/* Copyright 1992-2025 by Robert Cozzi, Jr.              */
/* All rights reserved.                                   */
/* Standalone SPOOLED_DATA UDTF - no *SRVPGM dependency  */
/**********************************************************/

int main(int argc, char *argv[])
{
    volatile int i = 0;
    int p = 0;
    int rc = 0;

    inChar(SPLFNAME);
    inChar(SPLNBR);
    inChar(JOB);

    inChar(BLANKS);
    inChar(EOF);

    inChar(STARTPAGE);
    inInt(STARTLINE);

    inBINARY(INTJOBID);
    inBINARY(INTSPLID);

    inChar(OPTIONS);

    inChar(SPLFNAME_ALT);
    inChar(SPLNBR_ALT);

    outChar(SPLFNAME);
    outINT(SPLNBR);
    outINT(SEQNBR);

    outINT(PAGENBR);
    outINT(LINENBR);
    outChar(PRTLINE);

    outINT(PGCNT);
    outSmallInt(PGLEN);
    outSmallInt(PGWIDTH);

    outChar(CRTSYSNAME);
    outChar(ORGSYSNAME);

    outChar(JOB);

    outVARCHAR(PRTLINE_BIN);

    inIndy(SPLFNAME);
    inIndy(SPLNBR);
    inIndy(JOB);

    inIndy(BLANKS);
    inIndy(EOF);

    inIndy(STARTPAGE);
    inIndy(STARTLINE);

    inIndy(INTJOBID);
    inIndy(INTSPLID);

    inIndy(OPTIONS);

    inIndy(SPLFNAME_ALT);
    inIndy(SPLNBR_ALT);

    outIndy(SPLFNAME);
    outIndy(SPLNBR  );
    outIndy(SEQNBR  );
    outIndy(PAGENBR );
    outIndy(LINENBR );
    outIndy(PRTLINE );

    outIndy(PGCNT   );
    outIndy(PGLEN   );
    outIndy(PGWIDTH );

    outIndy(CRTSYSNAME);
    outIndy(ORGSYSNAME);

    outIndy(JOB     );
    outIndy(PRTLINE_BIN);

    char *sqlstate =
        (char *)coz_getNextParmIf(p, argc, argv);
    char *funcName =
        (char *)coz_getNextParmIf(p, argc, argv);
    char *specificName =
        (char *)coz_getNextParmIf(p, argc, argv);
    char *sqlmsgtext =
        (char *)coz_getNextParmIf(p, argc, argv);
    char *scratchPad =
        (char *)coz_getNextParmIf(p, argc, argv);
    int  *sqlOpCode  =
        (int *)coz_getNextParmIf(p, argc, argv);

    scratch_t scratch;
    scratch_t *pScratch = (scratch_t *)scratchPad;

    jobName_t jobID;

    char *pBuffer = NULL;

    char INT_JobID[16];
    char INT_splfID[16];
    char splfName[10];
    char splfNbr[6];
    int  splNbr = -1;
    int  buffers = 8;
    char jobSysName[8];
    char splf_CrtDate[7];
    char splf_CrtTime[6];
    Qsp_SPFRH_t *pGenHdr = NULL;
    Qsp_SPFRB_t *pBufferInfo = NULL;
    Qsp_SPFRG_t *pGenData = NULL;
    Qsp_SPFRP_t *pPageData = NULL;
    Qus_SPLA0200_t splfAttr;
    userSpaceLen_t spBuffer;

    int checkBufferCount = 0;
    int pageFlag = 0;
    int EOL = 0;
    int line_Offset = 0;
    int hSplf = pScratch->hSplf;
    char APIFMT[9] = "SPFR0300";
    char openSPLF_EOF[11];

    coz_qusec ec;


    if (*sqlOpCode == SQLUDF_TF_OPEN)
    {
        memset((char *)&jobID, ' ', sizeof(jobID));
        memset((char *)INT_JobID, ' ',
               sizeof(INT_JobID));
        memset((char *)INT_splfID, ' ',
               sizeof(INT_splfID));

        memset((char*)pScratch, 0x00,
               sizeof(scratch));

        pScratch->hSplf = 0;
        pScratch->eof = 0;
        pScratch->counter = 0;

        pScratch->BUFFER_OFFSET = 0;
        pScratch->END_OF_BUFFERS = 0;
        pScratch->BUFFER_COUNT = 0;
        pScratch->BUFFERS_READ = 0;
        pScratch->NEXTRECORD = 0;
        pScratch->CURPAGENBR = 0;
        pScratch->CURLINENBR_ONPAGE = 0;
        pScratch->NEXTPAGE = 0;

        pScratch->toUpper = 0;
        pScratch->toLower = 0;
        pScratch->trimLeft = 0;
        pScratch->trimRight = 0;
        pScratch->omitBlanks = 0;
        pScratch->dltSplf = 0;
        coz_copyPad(pScratch->splfEOFAction,
                    "*ERROR",
                    sizeof(scratch.splfEOFAction));
        memset(pScratch->ruler, 0x00,
               sizeof(scratch.ruler));
        memset(pScratch->dltSplfCmd, 0x00,
               sizeof(scratch.dltSplfCmd));

        coz_toUpper(inSPLFNAME);
        coz_toUpper(inSPLNBR);
        coz_toUpper(inSTARTPAGE);
        coz_toUpper(inJOB);

        memset((char *)&splfAttr, 0x00,
               sizeof(splfAttr));

        coz_getProdLib(pScratch->prodLib);

        if (*indyInSTARTPAGE >= 0 &&
            strlen(inSTARTPAGE) > 0)
        {
                coz_toUpper(inSTARTPAGE);
                if (inSTARTPAGE[0] == '*')
                    inSTARTPAGE++;
                else if (memcmp(inSTARTPAGE,
                                "LAST", 4) == 0)
                {
                    pScratch->START_PAGE = -1;
                }
                else if (memcmp(inSTARTPAGE,
                                "FIRST", 5) == 0)
                {
                    pScratch->START_PAGE  = 1;
                }
                else
                {
                    char *ptr = NULL;
                    pScratch->START_PAGE =
                        strtol(inSTARTPAGE, &ptr, 10);
                }
        }
        else
        {
            pScratch->START_PAGE = 1;
        }
        if (*indyInSTARTLINE >= 0 &&
            *inSTARTLINE > 0)
        {
            pScratch->START_LINE = *inSTARTLINE;
        }
        else
        {
            pScratch->START_LINE = -1;
        }

        if (*indyInJOB >= 0 &&
            strlen(inJOB) > 1 &&
            inJOB[0] != '*')
        {
            int len = 0;
            int searchLen = strlen(inJOB);
            char szJob[32];
            memset(szJob, 0x00, sizeof(szJob));
            strcpy(szJob, inJOB);

            char *pSearch = szJob;

            char *pJobNbr = (char *)memchr(
                pSearch, '/', searchLen);
            if (pJobNbr != NULL)
            {
                len = (int)(pJobNbr - pSearch);
                searchLen -= len;
                _CPYBYTES(jobID.Job_Number,
                          pSearch, len);
                pSearch += (len + 1);

                char *pJobUser = (char *)memchr(
                    pSearch, '/', searchLen);
                if (pJobUser != NULL)
                {
                    len = (int)(pJobUser - pSearch);
                    searchLen -= len;
                    _CPYBYTES(jobID.Job_User,
                              pSearch, len);
                    pSearch += (len + 1);

                    char *pJobName =
                        (char *)memchr(pSearch, '/',
                                       searchLen);
                    if (pJobName == NULL)
                    {
                        _CPYBYTES(jobID.Job_Name,
                                  pSearch,
                                  strlen(pSearch));
                    }
                }
            }
        }

        else if (*indyInJOB >= 0 &&
                 strlen(inJOB) == 4 &&
                 memcmp(&inJOB, "*INT", 4) == 0 &&
                 inINTJOBID != NULL &&
                 *indyInINTJOBID >= 0)
        {
            memset((char *)&jobID, ' ',
                   sizeof(jobID));
            memcpy((char *)&jobID, "*INT", 4);
            memcpy((unsigned char *)INT_JobID,
                   (unsigned char *)inINTJOBID,
                   sizeof(INT_JobID));
        }

        else if (*indyInJOB >= 0 &&
                 strlen(inJOB) > 0 &&
                 inJOB[0] == '*')
        {
           memset((char*)&jobID,' ', sizeof(jobID));
           jobID.Job_Name[0] = '*';
        }

        if (jobID.Job_Name[0] == ' ')
        {
            jobID.Job_Name[0] = '*';
        }

        char* pSPLFNAME = NULL;
        char* pSPLNBR   = NULL;
        int   indy_SPLF    = -1;
        int   indy_SPLNBR  = -1;

        if (*indyInSPLFNAME_ALT >= 0 &&
            strlen(inSPLFNAME_ALT) > 0)
        {
           pSPLFNAME = inSPLFNAME_ALT;
           indy_SPLF = *indyInSPLFNAME_ALT;
        }
        else
        {
           pSPLFNAME = inSPLFNAME;
           indy_SPLF = *indyInSPLFNAME;
        }

        if (*indyInSPLNBR_ALT >= 0 &&
            strlen(inSPLNBR_ALT) > 0)
        {
           pSPLNBR = inSPLNBR_ALT;
           indy_SPLNBR = *indyInSPLNBR_ALT;
        }
        else
        {
           pSPLNBR = inSPLNBR;
           indy_SPLNBR = *indyInSPLNBR;
        }

        if (pSPLNBR != NULL &&
            indy_SPLNBR >= 0 &&
            strlen(pSPLNBR) > 0)
        {
            coz_toUpper(pSPLNBR);
            if (pSPLNBR[0] == '*') pSPLNBR++;
            if (memcmp(pSPLNBR, "ONLY", 4) == 0)
            {
                splNbr = 0;
            }
            else if (memcmp(pSPLNBR,
                            "LAST", 4) == 0)
            {
                splNbr = -1;
            }
            else if (memcmp(pSPLNBR,
                            "ANY", 3) == 0)
            {
                splNbr = -2;
            }
            else
            {
                char *ptr = NULL;
                splNbr = strtol(pSPLNBR,
                                &ptr, 10);
            }
        }

        coz_toUpper(pSPLFNAME);

        memset((char *)splfName, ' ',
               sizeof(splfName));
        if (indy_SPLF >= 0 &&
            strcmp(pSPLFNAME, "*INT") == 0)
        {
            memcpy((char *)splfName, "*INT", 4);
            memcpy((unsigned char *)INT_splfID,
                   (unsigned char *)inINTSPLID,
                   sizeof(INT_splfID));
        }
        else if (indy_SPLF >= 0 &&
                 memcmp(pSPLFNAME, "*LAST", 5)==0 ||
                (indy_SPLF < 0 && splNbr == -1))
        {
            Qsp_SPRL0100_t          lastSPLF1;
            Qgy_Olspl_RecVar_0300_t lastSPLF3;
            if (coz_getLastSPLF(&lastSPLF3,
                                pSPLFNAME) > 0)
            {
                splNbr = lastSPLF3.Spooled_File_No;
                coz_copyPad(splfName,
                    lastSPLF3.Spooled_File_Name,
                    sizeof(
                      lastSPLF3.Spooled_File_Name));
                coz_copyPad(jobID.Job_Name,
                    lastSPLF3.Job_Name, 10);
                coz_copyPad(jobID.Job_User,
                    lastSPLF3.User_Name, 10);
                coz_copyPad(jobID.Job_Number,
                    lastSPLF3.Job_No, 6);
            }
            else
            {
              Qsp_SPRL0100_t lastSPLF;
              char lastAPIFmt[] = "SPRL0100";

              memset((char *)&lastSPLF, 0x00,
                     sizeof(lastSPLF));
              memset((char *)splfName, ' ',
                     sizeof(splfName));

              ec.init();
              QSPRILSP(&lastSPLF,
                       sizeof(lastSPLF),
                       "SPRL0100", &ec);

              if (ec.isEmpty() &&
                  lastSPLF.Bytes_Return > 0)
              {
                _CPYBYTES(&splfName,
                          lastSPLF.Splf_Name,
                          sizeof(lastSPLF.Splf_Name));

                _CPYBYTES(jobID.Job_Name,
                          lastSPLF.Job_Name, 10);
                _CPYBYTES(jobID.Job_User,
                          lastSPLF.Usr_Name, 10);
                _CPYBYTES(jobID.Job_Number,
                          lastSPLF.Job_Number, 6);
                splNbr = lastSPLF.Splf_Number;
              }
              else
              {
                 coz_resignalMsg(ec);
              }
            }
        }
        else if (indy_SPLF >= 0)
        {
            coz_copyPad(splfName, pSPLFNAME, 10);
        }
        else
        {
            coz_copyPad(splfName, "*LAST", 10);
        }

        ec.init();
        memset((char *)&splfAttr, 0x00,
               sizeof(splfAttr));
        QUSRSPLA(&splfAttr, sizeof(splfAttr),
                 "SPLA0200",
                 (char *)&jobID,
                 (char *)INT_JobID,
                 (char *)INT_splfID,
                 (char *)splfName,
                 splNbr,
                 (void *)&ec);

        if (ec.hasError())
        {
           coz_resignalMsg(ec);
           coz_joblog(
              "%s: SPOOLED file %.10s"
              " SPLNBR(%d)"
              " JOB(%.6s/%.10s/%.10s)\n",
              funcName, splfName, splNbr,
              jobID.Job_Number,
              jobID.Job_User,
              jobID.Job_Name);
            strcpy(sqlstate, "02000");
            pScratch->eof = 1;
            return -1;
        }

        if (memcmp(splfAttr.Ptr_Dev_Type,
                   "*SCS", 4) == 0)
            pScratch->DEVTYPE = 'S';
        else if (memcmp(splfAttr.Ptr_Dev_Type,
                        "*AFP", 4) == 0)
            pScratch->DEVTYPE = 'A';

        if (memcmp(splfAttr.Ptr_Dev_Type,
                   "*SCS", 4) != 0 &&
            memcmp(splfAttr.Ptr_Dev_Type,
                   "*AFP", 4) != 0)
        {
            coz_joblog(
               "ST_SPOOLDATA: Unsupported "
               "spool device type %.4s\n",
               splfAttr.Ptr_Dev_Type);
            strcpy(sqlstate, "02000");
            pScratch->eof = 1;
            return -1;
        }

        ec.init();

        _CPYBYTES(&(pScratch->splfAttr),
                  &splfAttr, sizeof(splfAttr));

        if (memcmp(splfAttr.Status,
                   "*IMMED", 6) == 0)
        {
            pScratch->BUFFER_RQS = 1;
        }
        else
        {
            pScratch->BUFFER_RQS = 8;
        }

        memset(&jobID, ' ', sizeof(jobID));
        memcpy(&jobID, "*INT", 4);
        memset(splfName, ' ', sizeof(splfName));
        memcpy((char *)splfName, "*INT", 4);
        memcpy(INT_JobID, splfAttr.Int_Job_ID,
               sizeof(splfAttr.Int_Job_ID));
        memcpy(INT_splfID, splfAttr.Int_Splf_ID,
               sizeof(splfAttr.Int_Splf_ID));

        QSPOPNSP(&(pScratch->hSplf),
                 (char *)&jobID,
                 (char *)INT_JobID,
                 (char *)INT_splfID,
                 (char *)splfName,
                 splNbr,
                 pScratch->BUFFER_RQS,
                 (void *)&ec
        );

        if (ec.hasError())
        {
            Qp0zLprintf(
                "%s returned %.7s = %.48s\n",
                funcName,
                ec.msgid(), ec.msgdata());
            strcpy(sqlstate, "02000");
            pScratch->eof = 1;
            return -1;
        }
        pBuffer = coz_TEMP_USRSPACE(
            (char *)pScratch->QUSRSPACE);

        std::string opt;
        pScratch->omitBlanks = 1;

        if (inBLANKS != NULL &&
            indyInBLANKS >= 0 &&
            strlen(inBLANKS) > 0)
        {
            coz_toUpper(inBLANKS);
            opt = inBLANKS;
            pScratch->omitBlanks =
               (opt.find("KEE") !=
                std::string::npos) ||
               (opt.find("INC") !=
                std::string::npos) ||
               (opt.find("RET") !=
                std::string::npos) ||
               (inBLANKS[0] == '1') ||
               (opt.find("YES") !=
                std::string::npos)
                  ? 0 : 1;
        }
        if (inEOF != NULL &&
            indyInEOF >= 0 &&
            strlen(inEOF) > 0)
        {
            coz_toUpper(inEOF);
            opt = inEOF;
            coz_copyPad(pScratch->splfEOFAction,
               (opt.find("WAIT")  !=
                std::string::npos) ? "*WAIT"  :
               (opt.find("ERROR") !=
                std::string::npos) ? "*ERROR" :
               (opt.find("IGNORE")!=
                std::string::npos) ? "*ERROR" :
               (opt.find("IMMED") !=
                std::string::npos) ? "*ERROR" :
               "*ERROR");
        }

        if (inOPTIONS != NULL &&
            indyInOPTIONS >= 0 &&
            strlen(inOPTIONS) > 0)
        {
            coz_toUpper(inOPTIONS);
            opt = inOPTIONS;
            pScratch->toUpper =
               (opt.find("UP") !=
                std::string::npos) ? 1 : 0;
            pScratch->toLower =
               (opt.find("LO") !=
                std::string::npos) ? 1 : 0;

            pScratch->trimLeft =
               (opt.find("LEF") !=
                std::string::npos) ||
               (opt.find("TRIML") !=
                std::string::npos) ||
               (opt.find("ADJ") !=
                std::string::npos)
                  ? 1 : 0;

            pScratch->trimRight =
               (opt.find("RIG") !=
                std::string::npos) ||
               (opt.find("TRIMR") !=
                std::string::npos)
                  ? 1 : 0;
            pScratch->dltSplf =
               (opt.find("DLT") !=
                std::string::npos ||
                opt.find("DEL") !=
                std::string::npos)
                   ? 1 : 0;
            pScratch->omitBlanks =
               (opt.find("KEE") !=
                std::string::npos) ||
               (opt.find("INC") !=
                std::string::npos) ||
               (opt.find("BLAN") !=
                std::string::npos) ||
               (opt.find("RET") !=
                std::string::npos)
                  ? 0 : 1;
            char szEOF[11];
            _CPYBYTES(szEOF,
                      pScratch->splfEOFAction,
                      10);
            szEOF[10] = 0x00;
            coz_copyPad(pScratch->splfEOFAction,
               (opt.find("WAIT")  !=
                std::string::npos) ? "*WAIT"  :
               (opt.find("ERROR") !=
                std::string::npos) ? "*ERROR" :
               (opt.find("IGNORE")!=
                std::string::npos) ? "*ERROR" :
               (opt.find("IMMED") !=
                std::string::npos) ? "*ERROR" :
               szEOF);

            if (opt.find("RU") !=
                std::string::npos &&
                splfAttr.Page_Width > 0)
            {
                char szDigit[8];
                int r_offset = 0;
                memset(pScratch->ruler, 0x00,
                       sizeof(scratch.ruler));
                memset(pScratch->ruler, '.',
                       splfAttr.Page_Width);
                pScratch->ruler[0] = '*';

                for (int r = 4;
                     r < splfAttr.Page_Width;
                     r += 5)
                {
                    pScratch->ruler[r] = 'v';
                }

                for (int r = 9;
                     r < splfAttr.Page_Width;
                     r += 10)
                {
                    sprintf(szDigit, "%d", r + 1);

                    r_offset =
                       (r + 1 >= 1000) ? 3 :
                       (r + 1 >= 100)  ? 2 :
                       (r + 1 >= 10)   ? 1 : 0;

                    _CPYBYTES(pScratch->ruler +
                              (r - r_offset),
                              szDigit,
                              strlen(szDigit));
                }
                sprintf(szDigit, "%d",
                        splfAttr.Page_Width);
                r_offset =
                   (splfAttr.Page_Width >= 1000)
                      ? 4 :
                   (splfAttr.Page_Width >= 100)
                      ? 3 :
                   (splfAttr.Page_Width >= 10)
                      ? 2 :
                   (splfAttr.Page_Width > 0)
                      ? 1 : 0;
                _CPYBYTES(
                    pScratch->ruler +
                    (splfAttr.Page_Width -
                     r_offset),
                    szDigit, strlen(szDigit));
                for (int r =
                     splfAttr.Page_Width -
                     (r_offset + 1);
                     r > 0; r--)
                {
                    if (isdigit(pScratch->ruler[r]))
                        pScratch->ruler[r] = '.';
                    else
                        break;
                }
            }
            else
            {
                pScratch->counter++;
            }
        }
        else
        {
            pScratch->counter++;
        }

        char szJobNbr[
            sizeof(splfAttr.Job_Number) + 1];
        char szJobName[
            sizeof(splfAttr.Job_Name) + 1];
        char szJobUser[
            sizeof(splfAttr.Usr_Name) + 1];
        coz_copyUntil(szJobNbr,
                      splfAttr.Job_Number,
                      sizeof(splfAttr.Job_Number));
        coz_copyUntil(szJobName,
                      splfAttr.Job_Name,
                      sizeof(splfAttr.Job_Name));
        coz_copyUntil(szJobUser,
                      splfAttr.Usr_Name,
                      sizeof(splfAttr.Usr_Name));
        sprintf(pScratch->job,
                "%.6s/%.10s/%.10s",
                szJobNbr, szJobUser, szJobName);

        coz_copyUntil(pScratch->splfname,
                      splfAttr.Splf_Name,
                      sizeof(splfAttr.Splf_Name));
        pScratch->splnbr = splfAttr.Splf_Number;

        if (pScratch->START_PAGE == 0)
        {
            pScratch->START_PAGE = 1;
        }
        else if (pScratch->START_PAGE < 0)
        {
           pScratch->START_PAGE =
               pScratch->splfAttr.Total_Pages;
        }

        if (pScratch->START_PAGE >
            pScratch->splfAttr.Total_Pages)
        {
            coz_joblog(
               "SPOOLED_DATA(START_PAGE=>%d)"
               " is greater than"
               " %d total pages.\n",
               pScratch->START_PAGE,
               pScratch->splfAttr.Total_Pages);
            strcpy(sqlstate, "02000");
            pScratch->eof = 1;
            pScratch->END_OF_BUFFERS = 1;
            return 0;
        }

        if (pScratch->dltSplf == 1)
        {
           sprintf(pScratch->dltSplfCmd,
                   "QSYS/DLTSPLF"
                   " FILE(%s)"
                   " SPLNBR(%d)"
                   " JOB(%s)",
                    pScratch->splfname,
                    pScratch->splnbr,
                    pScratch->job);
        }

    }

    if (*sqlOpCode == SQLUDF_TF_FETCH &&
        pScratch->eof == 1)
    {
        strcpy(sqlstate, "02000");
    }
    if (*sqlOpCode == SQLUDF_TF_FETCH &&
        pScratch->eof == 0)
    {

        *indySEQNBR = 0;
        *indyPAGENBR = 0;
        *indyLINENBR = 0;
        *indyPRTLINE = 0;
        *indyPRTLINE_BIN = 0;
        spBufferStatus_t splStat;

        coz_copyUntil(outSPLFNAME,
                      pScratch->splfname,
                      sizeof(scratch.splfname));
        *outSPLNBR = pScratch->splnbr;
        strcpy(outJOB, pScratch->job);

        coz_copyUntil(outORGSYSNAME,
                  pScratch->splfAttr.Original_System,
                  sizeof(
                   splfAttr.Original_System));
        coz_copyUntil(outCRTSYSNAME,
                  pScratch->splfAttr.Job_System_Name,
                  sizeof(
                   splfAttr.Job_System_Name));

        *outPGCNT   = pScratch->splfAttr.Total_Pages;
        *outPGLEN   = pScratch->splfAttr.Page_Length;
        *outPGWIDTH = pScratch->splfAttr.Page_Width;

        pGenHdr = NULL;

        if (pScratch->BUFFER_COUNT > 0)
        {
            pGenHdr = (Qsp_SPFRH_t *)
                &(pScratch->BUFFER_HDR);
        }
        else
        {
            if (pScratch->NEXTRECORD <= 0)
            {
                pScratch->NEXTRECORD = 1;
            }
            else
            {
                pScratch->NEXTRECORD = -1;
            }
            ec.init();
            QSPGETSP(hSplf,
                     pScratch->QUSRSPACE,
                     APIFMT,
                     pScratch->NEXTRECORD,
                     pScratch->splfEOFAction,
                     &ec);

            if (ec.hasError())
            {
                if (ec.compare("CPF33D7"))
                {
                    checkBufferCount = 1;
                }
                else if (ec.compare("CPF33D6"))
                {
                    pScratch->END_OF_BUFFERS = 1;
                }
            }
        }

        pBuffer = (char *)coz_getPtrUsrSpace(
            (const char *)pScratch->QUSRSPACE);

        if (pGenHdr == NULL)
        {
            pGenHdr = (Qsp_SPFRH_t *)pBuffer;
            pScratch->CURPAGENBR =
                pGenHdr->First_Page_Nbr;
            pScratch->BUFFER_COUNT +=
                pGenHdr->Buffers_Returned;
            pScratch->BUFFER_SIZE =
                pGenHdr->Size_Print_Data300;
            pScratch->BUFFER_OFFSET = 0;

            _CPYBYTES((char *)&(pScratch->BUFFER_HDR),
                      (char *)pGenHdr,
                      sizeof(Qsp_SPFRH_t));
        }

        memset(outPRTLINE, 0x00,
               pScratch->splfAttr.Page_Width + 2);
        outPRTLINE_BIN->length = 0;

        if (pScratch->BUFFER_COUNT >=
            pScratch->splfAttr.Number_Buffers)
        {
            pScratch->END_OF_BUFFERS = 1;
        }

        if (pScratch->BUFFER_COUNT == 0)
        {
            strcpy(sqlstate, "02000");
            pScratch->eof = 1;
            pScratch->END_OF_BUFFERS = 1;
        }
        else if (pGenHdr->Buffers_Returned <
                 pGenHdr->Buffers_Requested)
        {
            pScratch->END_OF_BUFFERS = 1;
        }

        if (pScratch->BUFFER_SIZE > 0 &&
            strlen(pScratch->ruler) == 0)
        {
            pBufferInfo = (Qsp_SPFRB_t *)
                (pBuffer +
                 pGenHdr->Offset_First_Buffer);
            pBuffer +=
                pGenHdr->Offset_First_Buffer;
            if (pScratch->BUFFER_COUNT >=
                    pScratch->splfAttr.Number_Buffers
                || pScratch->END_OF_BUFFERS
                || pGenHdr->Buffers_Returned <
                   pGenHdr->Buffers_Requested)
            {
                if (pBuffer[
                    pGenHdr->Size_Print_Data300
                    - 1] == 0x0c)
                {
                    pBuffer[
                     pGenHdr->Size_Print_Data300
                     - 1] = 0x00;
                }
            }

            for (;;)
            {
                memset((char *)&splStat, 0x00,
                       sizeof(splStat));
                if (pScratch->DEVTYPE == 'S')
                {
                  rc = READSPLINE(pBuffer,
                        pScratch->BUFFER_SIZE,
                        pScratch->BUFFER_OFFSET,
                        outPRTLINE,
                        MAXLINELEN,
                        splStat);
                }
                else if (pScratch->DEVTYPE == 'A')
                {
                  rc = readAFPLine(pBuffer,
                        pScratch->BUFFER_SIZE,
                        pScratch->BUFFER_OFFSET,
                        outPRTLINE,
                        MAXLINELEN,
                        splStat);
                }
                if (pScratch->BUFFER_OFFSET >=
                    pScratch->BUFFER_SIZE &&
                    strlen(outPRTLINE) > 0 &&
                    rc < 0)
                {
                    rc = 0;
                }

                if (rc < 0 &&
                    pScratch->END_OF_BUFFERS == 1)
                {
                    strcpy(sqlstate, "02000");
                    pScratch->eof = 1;
                    return 0;
                }
                if (rc < 0 &&
                    pScratch->END_OF_BUFFERS == 0)
                {
                    pScratch->NEXTRECORD = -1;
                    ec.init();
                    QSPGETSP(hSplf,
                             pScratch->QUSRSPACE,
                             APIFMT,
                             pScratch->NEXTRECORD,
                             pScratch->splfEOFAction,
                             &ec);

                    if (ec.hasError())
                    {
                        if (ec.compare("CPF33D7"))
                        {
                            checkBufferCount = 1;
                        }
                        else if (
                            ec.compare("CPF33D6"))
                        {
                            pScratch->END_OF_BUFFERS
                                = 1;
                        }
                    }
                    if (ec.isEmpty() ||
                        ec.compare("CPF33D6"))
                    {
                        pBuffer = (char *)
                            coz_getPtrUsrSpace(
                              (const char *)
                              pScratch->QUSRSPACE);
                        pGenHdr =
                           (Qsp_SPFRH_t *)pBuffer;
                        _CPYBYTES(
                           (char *)&(
                              pScratch->BUFFER_HDR),
                           (char *)pGenHdr,
                           sizeof(Qsp_SPFRH_t));

                        pScratch->BUFFER_COUNT +=
                           pGenHdr->Buffers_Returned;
                        pScratch->BUFFER_SIZE =
                           pGenHdr->Size_Print_Data300;
                        pScratch->BUFFER_OFFSET = 0;
                        if (pGenHdr->Buffers_Returned
                            <
                            pGenHdr->Buffers_Requested)
                        {
                            pScratch->END_OF_BUFFERS
                                = 1;
                        }
                        pBufferInfo =
                           (Qsp_SPFRB_t *)
                           (pBuffer +
                            pGenHdr->Offset_First_Buffer);
                        pBuffer +=
                           pGenHdr->Offset_First_Buffer;

                        if (pScratch->BUFFER_COUNT >=
                            pScratch->splfAttr
                               .Number_Buffers ||
                            pScratch->END_OF_BUFFERS ||
                            pGenHdr->Buffers_Returned <
                            pGenHdr->Buffers_Requested)
                        {
                            if (pBuffer[
                                pGenHdr
                                 ->Size_Print_Data300
                                 - 1] == 0x0c)
                            {
                                pBuffer[
                                 pGenHdr
                                  ->Size_Print_Data300
                                  - 1] = 0x00;
                            }
                        }
                        continue;
                    }
                }
                if (splStat.lineLen >= 0)
                {
                  outPRTLINE[splStat.lineLen] =
                      0x00;
                }
                else
                {
                  outPRTLINE[0] = 0x00;
                }

                if (pScratch->omitBlanks == 1 &&
                    (
                     (splStat.lineLen <= 0 &&
                      splStat.newPage == 0) ||
                     ::triml(outPRTLINE,' ') == 0))
                {
                   pScratch->CURLINENBR_ONPAGE++;
                   if (splStat.newPage)
                   {
                     pScratch->CURPAGENBR++;
                     pScratch->NEXTPAGE = 0;
                     pScratch->CURLINENBR_ONPAGE = 0;
                   }
                   outPRTLINE[0] = 0x00;
                   continue;
                }

                if (pScratch->START_PAGE > 1 &&
                    pScratch->CURPAGENBR <
                    pScratch->START_PAGE)
                {
                   if (splStat.newPage)
                   {
                     pScratch->CURPAGENBR++;
                     pScratch->NEXTPAGE = 0;
                     pScratch->CURLINENBR_ONPAGE = 0;
                   }
                   else
                   {
                     pScratch->CURLINENBR_ONPAGE++;
                   }
                   outPRTLINE[0] = 0x00;
                   continue;
                }
                if (pScratch->CURPAGENBR ==
                    pScratch->START_PAGE)
                {
                    if (pScratch->CURLINENBR_ONPAGE+1
                        < pScratch->START_LINE)
                    {
                        if (splStat.newPage)
                        {
                            pScratch->CURPAGENBR++;
                            pScratch->NEXTPAGE = 0;
                            pScratch
                              ->CURLINENBR_ONPAGE = 0;
                        }
                        if (pScratch
                              ->CURLINENBR_ONPAGE==0
                            || !splStat.newPage)
                        {
                            pScratch
                              ->CURLINENBR_ONPAGE++;
                        }
                        outPRTLINE[0] = 0x00;
                        continue;
                    }
                    else if (pScratch->bStarted == 0)
                    {
                        pScratch->CURLINENBR_ONPAGE++;
                        pScratch->bStarted = 1;
                    }
                }

                break;
            }

            if (splStat.newPage)
            {
                pScratch->NEXTPAGE = 1;
            }

            coz_copyUntilVar(outPRTLINE_BIN,
                             outPRTLINE,
                             strlen(outPRTLINE),
                             false, false);

            if (splStat.lineLen > 0)
            {
                if (pScratch->toUpper == 1 &&
                    pScratch->toLower == 0)
                {
                    coz_toUpper(outPRTLINE);
                }
                else if (pScratch->toUpper == 0 &&
                         pScratch->toLower == 1)
                {
                    coz_toLower(outPRTLINE);
                }
                if (pScratch->trimLeft == 1)
                {
                    char *pLine = outPRTLINE;
                    int start = 0;
                    int newLen = 0;
                    while (*pLine &&
                           isspace(
                            (unsigned char)*pLine))
                    {
                        pLine++;
                    }
                    if (pLine != outPRTLINE)
                    {
                       start = pLine - outPRTLINE;
                       newLen = splStat.lineLen
                                - start;
                       memmove(outPRTLINE,
                               pLine, newLen);
                       outPRTLINE[newLen] = 0x00;
                    }
                }
            }
        }

        if (strlen(pScratch->ruler) > 0)
        {
            strcpy(outPRTLINE, pScratch->ruler);
            pScratch->ruler[0] = 0x00;
            *indyPAGENBR = -1;
            *indyLINENBR = -1;
        }
        else if (pScratch->CURLINENBR_ONPAGE == 0)
        {
            pScratch->CURLINENBR_ONPAGE++;
        }
        *outLINENBR =
            pScratch->CURLINENBR_ONPAGE++;

        if (pScratch->counter == 0)
        {
            pScratch->counter++;
        }
        *outSEQNBR = pScratch->counter++;
        *outPAGENBR = pScratch->CURPAGENBR;

        if (pScratch->trimRight &&
            strlen(outPRTLINE) > 0)
        {
            outPRTLINE[
                ::triml(outPRTLINE, ' ')] = 0x00;
        }

        if (pScratch->NEXTPAGE == 1 ||
            (pScratch->CURPAGENBR == 0 &&
             strlen(pScratch->ruler) == 0))
        {
            pScratch->CURPAGENBR++;
            pScratch->NEXTPAGE = 0;
            pScratch->CURLINENBR_ONPAGE = 0;
        }
    }
    if (*sqlOpCode == SQLUDF_TF_CLOSE)
    {
        if (pScratch->hSplf != NULL)
        {
            ec.init();
            QSPCLOSP(pScratch->hSplf, &ec);
            pScratch->hSplf = NULL;
        }
        if (pScratch->QUSRSPACE[0] != ' ')
        {
            coz_DLTOBJ(pScratch->QUSRSPACE,
                       "*USRSPC");
            pScratch->QUSRSPACE[0] = ' ';
        }

        if (pScratch->dltSplf == 1)
        {
            if (strlen(pScratch->dltSplfCmd) > 16)
            {
                coz_joblog(pScratch->dltSplfCmd);
                system(pScratch->dltSplfCmd);
            }
        }
    }
    if (*sqlOpCode == SQLUDF_TF_FINAL ||
        *sqlOpCode == SQLUDF_TF_FINAL_CRA)
    {
        if (pScratch->hSplf != NULL)
        {
            ec.init();
            QSPCLOSP(pScratch->hSplf, &ec);
            pScratch->hSplf = NULL;
        }
    }
}

typedef _Packed struct tagAFPDS
{
   char ctrlCode;
   unsigned short  len;
   char flag;
   char recid[2];
   char data[];
} afpds_t;


int readAFPLine(char* ptr_To_SPOOL_FILE_BUFFER,
                int   buffer_size,
                int&  offset_within_Buffer,
                char* outputBuffer,
                int   obLen,
                spBufferStatus_t& spStat
               )
{
     int maxLineLength = obLen;

     int i = 0;
     int c = 0;
     int buffLen = buffer_size;

     int bEOL = 0;
     int bEOP = 0;
     char* pEOL = NULL;
     char* pEOP = NULL;

     char* p = ptr_To_SPOOL_FILE_BUFFER;
     char* t = outputBuffer;
     int   len = buffer_size;
     int   bo  = offset_within_Buffer;

     afpds_t*   pAFPDS = NULL;

     c = strlen(outputBuffer);

     unsigned char* pBuffer = NULL;
     spStat.cmd = 0;
     spStat.parm = 0;
     spStat.lineFeed = 0;
     spStat.lineLen = 0;
     spStat.newPage = 0;

     pBuffer = (unsigned char*)(p + bo);
     len -= bo;
     int dataLen = buffer_size - bo;
     int  x = 0;
     bool bControl = false;
     bool bTextLine = false;

     const char chlCtrl[] = {
         0x8B, 0x93, 0x9B, 0xA3, 0xAB,
         0xB3, 0xBB, 0xC3, 0xCB, 0xD3,
         0xDB, 0xDe, 0x00 };

     const char ctrlCode = 0x5A;
     const char space1 = 0x0B;
     const char space2 = 0x13;
     const char space3 = 0x1B;
     const char textLine[] =
         { 0x2B, 0xD3, 0x04, 0xC6 };

     for (i = 0; i < len ; i++)
     {
        bControl = false;
        bTextLine = false;

        for (; i < len ; i++)
        {
           if (memcmp(pBuffer + i,
                      textLine,
                      sizeof(textLine)) == 0 &&
               (*(pBuffer + i +
                  sizeof(textLine)) != 0x00 ||
                *(pBuffer + i +
                  sizeof(textLine)+1) != 0x00))
           {
              bTextLine = true;
              break;
           }
           if (pBuffer[i] == 0x5A)
           {
              pAFPDS = (afpds_t*)(pBuffer + i);
              if (pAFPDS->ctrlCode == 0x5A &&
                  pAFPDS->len > 0 &&
                 (pAFPDS->recid[0] == 0xEE &&
                  (pAFPDS->recid[1] == 0x9B ||
                   pAFPDS->recid[1] == 0xEC)))
              {
                 bControl = true;
                 i += sizeof(afpds_t);
                 break;
              }
              else
              {
                 i += pAFPDS->len;
              }
           }
        }
        if (!bControl && !bTextLine)
        {
           break;
        }
        x = 0;
        if (bControl)
        {
           dataLen = pAFPDS->len - 5;
           while ( x < dataLen)
           {
            unsigned char* pLine =
                pBuffer + (i + x);

            if (memcmp(pLine, textLine,
                       sizeof(textLine)) == 0 &&
               (*(pLine+sizeof(textLine))
                   != 0x00 ||
                *(pLine+sizeof(textLine)+1)
                   != 0x00))
             {
                bTextLine = true;
                i += x;
                break;
             }
             x++;
           }
         }
         if (bTextLine)
         {
           i += sizeof(textLine) + 2;
           for ( ; i < len; i++)
           {
             if (pBuffer[i] == 0x2B) break;
             if (pBuffer[i] == 0xFF) break;
             if (pBuffer[i] == 0x5A) break;
             if (pBuffer[i] == 0x00) break;
             if (pBuffer[i] < 0x40)  break;
             *(t+c) = pBuffer[i];
             c++;
           }
           break;
         }
     }
     offset_within_Buffer += i;
     spStat.lineLen = c;

     return (offset_within_Buffer >=
             buffer_size &&
             i == 0 && c == 0) ? -1 :
                                  spStat.lineLen;
 }

`;
}
