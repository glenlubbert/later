#!/usr/bin/env python3
"""Builds the "Save to Later" iOS/macOS Shortcut and signs it so it can be
imported on any device. The shortcut asks for the site address and a token
when it is added, so one file works for every Later site. macOS only."""
import plistlib, subprocess, sys, uuid, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
unsigned = root / "scripts" / "unsigned.shortcut"
signed = root / "public" / "later.shortcut"

U_BASE, U_TOKEN, U_URL, U_REQ = (str(uuid.uuid4()).upper() for _ in range(4))

def text(s):
    return {"Value": {"string": s}, "WFSerializationType": "WFTextTokenString"}

def text_with(prefix, out_uuid, out_name):
    return {
        "Value": {
            "string": prefix + "￼",
            "attachmentsByRange": {
                "{%d, 1}" % len(prefix): {"OutputName": out_name, "OutputUUID": out_uuid, "Type": "ActionOutput"}
            },
        },
        "WFSerializationType": "WFTextTokenString",
    }

def dictionary(key, value):
    return {
        "Value": {"WFDictionaryFieldValueItems": [{"WFItemType": 0, "WFKey": text(key), "WFValue": value}]},
        "WFSerializationType": "WFDictionaryFieldValue",
    }

# The shared item itself, as text. Sent alongside the detected link so the
# server can still find the address when "Get URLs" comes back empty.
INPUT_TEXT = {
    "Value": {"string": "\ufffc", "attachmentsByRange": {"{0, 1}": {"Type": "ExtensionInput"}}},
    "WFSerializationType": "WFTextTokenString",
}

actions = [
    {"WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
     "WFWorkflowActionParameters": {"UUID": U_BASE, "WFTextActionText": ""}},
    {"WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
     "WFWorkflowActionParameters": {"UUID": U_TOKEN, "WFTextActionText": ""}},
    {"WFWorkflowActionIdentifier": "is.workflow.actions.detect.link",
     "WFWorkflowActionParameters": {
         "UUID": U_URL,
         "WFInput": {"Value": {"Type": "ExtensionInput"}, "WFSerializationType": "WFTextTokenAttachment"}}},
    {"WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
     "WFWorkflowActionParameters": {
         "UUID": U_REQ,
         "WFURL": {
             "Value": {
                 "string": "\ufffc/api/save?plain=1",
                 "attachmentsByRange": {"{0, 1}": {"OutputName": "Text", "OutputUUID": U_BASE, "Type": "ActionOutput"}},
             },
             "WFSerializationType": "WFTextTokenString",
         },
         "WFHTTPMethod": "POST",
         "ShowHeaders": True,
         "WFHTTPHeaders": dictionary("Authorization", text_with("Bearer ", U_TOKEN, "Text")),
         "WFHTTPBodyType": "JSON",
         "WFJSONValues": {
             "Value": {"WFDictionaryFieldValueItems": [
                 {"WFItemType": 0, "WFKey": text("url"), "WFValue": text_with("", U_URL, "URLs")},
                 {"WFItemType": 0, "WFKey": text("text"), "WFValue": INPUT_TEXT}]},
             "WFSerializationType": "WFDictionaryFieldValue"}}},
    {"WFWorkflowActionIdentifier": "is.workflow.actions.notification",
     "WFWorkflowActionParameters": {
         "WFNotificationActionTitle": "Later",
         "WFNotificationActionBody": text_with("", U_REQ, "Contents of URL"),
         "WFNotificationActionSound": False}},
]

shortcut = {
    "WFWorkflowClientVersion": "2302.0.4",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4251333119, "WFWorkflowIconGlyphNumber": 59493},
    "WFWorkflowTypes": ["ActionExtension"],
    "WFWorkflowInputContentItemClasses": [
        "WFURLContentItem", "WFStringContentItem"],
    "WFWorkflowOutputContentItemClasses": [],
    "WFWorkflowHasShortcutInputVariables": True,
    "WFWorkflowHasOutputFallback": False,
    "WFWorkflowImportQuestions": [
        {"ActionIndex": 0, "Category": "Parameter", "DefaultValue": "",
         "ParameterKey": "WFTextActionText",
         "Text": "Your Later address, e.g. https://read.example.com (no slash at the end)"},
        {"ActionIndex": 1, "Category": "Parameter", "DefaultValue": "",
         "ParameterKey": "WFTextActionText",
         "Text": "Paste the token from Later > Settings > iPhone & iPad"}],
    "WFWorkflowActions": actions,
}

with open(unsigned, "wb") as f:
    plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY)
result = subprocess.run(
    ["shortcuts", "sign", "--mode", "anyone", "--input", str(unsigned), "--output", str(signed)],
    capture_output=True, text=True)
unsigned.unlink()
if result.returncode != 0 or not signed.exists():
    sys.exit("Signing failed: " + (result.stderr or result.stdout))
print("Wrote", signed, signed.stat().st_size, "bytes")
