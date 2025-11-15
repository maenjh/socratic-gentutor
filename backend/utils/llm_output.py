import re
import json
from typing import Dict, Any
try:
    from langchain_core.messages import AIMessage
except Exception:
    AIMessage = None


def fix_json_string(s: str) -> str:
    """
    Aggressively fix common JSON string issues.
    """
    # Remove/escape control characters that break JSON
    s = re.sub(r'[\x00-\x1f\x7f]', '', s)  # Remove control chars
    
    # Fix unescaped quotes inside strings (heuristic)
    # This is tricky - we try to detect unescaped quotes
    s = s.replace('\\"', '<<<ESCAPED_QUOTE>>>')  # Temporarily mark escaped quotes
    
    # Fix common escape issues
    s = s.replace('\\n', '\n').replace('\\t', '\t')  # Unescape newlines/tabs
    s = s.replace('\n', ' ').replace('\t', ' ')      # Remove actual newlines/tabs
    s = s.replace('<<<ESCAPED_QUOTE>>>', '\\"')     # Restore escaped quotes
    
    # Remove trailing commas
    s = re.sub(r',(\s*[}\]])', r'\1', s)
    
    # Add missing commas between fields (e.g., }" "field" -> }, "field")
    s = re.sub(r'"\s*"([^"]+)":', r'", "\1":', s)
    s = re.sub(r'([}\]])\s*"', r'\1, "', s)
    
    return s

def extract_and_repair_json(output: str) -> str:
    """
    Extract JSON and attempt repairs with very aggressive fixes.
    """
    # Find JSON boundaries
    start = output.find('{')
    end = output.rfind('}')
    
    if start == -1 or end == -1:
        # Try array
        start = output.find('[')
        end = output.rfind(']')
        if start == -1 or end == -1:
            return output
    
    # Extract and extend end if truncated
    json_str = output[start:end+1]
    
    # Pre-process: remove obvious bad characters
    json_str = re.sub(r'[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]', '', json_str)
    
    # Count quotes to detect unterminated strings
    in_string = False
    escaped = False
    fixed_chars = []
    open_braces = 0
    last_field_key = None
    
    for i, char in enumerate(json_str):
        if escaped:
            fixed_chars.append(char)
            escaped = False
            continue
            
        if char == '\\':
            escaped = True
            fixed_chars.append(char)
            continue
            
        if char == '"':
            in_string = not in_string
            fixed_chars.append(char)
        elif char in '{[':
            open_braces += 1
            fixed_chars.append(char)
        elif char in '}]':
            # If we're in a string, close it first
            if in_string:
                fixed_chars.append('"')
                in_string = False
            open_braces -= 1
            fixed_chars.append(char)
        elif char == '\n' and in_string:
            # Replace newlines in strings with space
            fixed_chars.append(' ')
        else:
            fixed_chars.append(char)
    
    # Close any unclosed strings or braces
    if in_string:
        fixed_chars.append('"')
    while open_braces > 0:
        fixed_chars.append('}')
        open_braces -= 1
    
    result = ''.join(fixed_chars)
    
    # Post-process: fix common patterns
    # Fix missing commas before closing braces (e.g., "value"} -> "value"}
    result = re.sub(r'"\s*([}\]])', r'"\1', result)
    
    return result

def convert_single_quotes_to_double(text: str) -> str:
    """
    Convert single-quoted JSON to double-quoted JSON.
    This handles cases where LLM outputs Python-style single quotes.
    """
    # First, protect already escaped single quotes
    text = text.replace("\\'", "<<<ESCAPED_SINGLE>>>")
    
    # Convert single quotes to double quotes for JSON compatibility
    # We need to be careful to only convert quotes that are field delimiters
    result = []
    in_string = False
    i = 0
    
    while i < len(text):
        char = text[i]
        
        if char == "'" and (i == 0 or text[i-1] != '\\'):
            # This is an unescaped single quote - convert to double quote
            result.append('"')
            in_string = not in_string
        elif char == '"' and in_string:
            # If we find a double quote inside a single-quoted string, escape it
            result.append('\\"')
        else:
            result.append(char)
        
        i += 1
    
    # Restore escaped single quotes (now inside double-quoted strings)
    result_str = ''.join(result)
    result_str = result_str.replace("<<<ESCAPED_SINGLE>>>", "'")
    
    return result_str

def convert_json_output(output: str) -> Dict[str, Any]:
    """
    Convert raw JSON output from the LLM into structured format with aggressive repair.

    Args:
        output: The JSON output from the LLM
        
    Returns:
        Structured JSON output
    """
    output = output.strip()
    
    # DEBUG: Log the raw output for analysis
    print(f"DEBUG RAW LLM OUTPUT (length: {len(output)}, first 800 chars):\n{output[:800]}\n{'='*80}")
    if len(output) > 800:
        print(f"DEBUG RAW LLM OUTPUT (last 300 chars):\n...{output[-300:]}\n{'='*80}")
    
    # Remove markdown code fences
    if output.startswith("```json"):
        output = output[7:].strip()
    if output.startswith("```"):
        output = output[3:].strip()
    if output.endswith("```"):
        output = output[:-3].strip()
    
    output = re.sub(r'^```(?:json)?\s*', '', output, flags=re.MULTILINE)
    output = re.sub(r'```\s*$', '', output, flags=re.MULTILINE)
    output = output.strip()
    
    # CRITICAL: Convert single-quoted JSON to double-quoted JSON
    # Check if output appears to use single quotes (Python-style)
    if "': '" in output or "', '" in output or output.count("'") > output.count('"'):
        print("DEBUG: Detected single-quoted JSON, converting to double quotes")
        output = convert_single_quotes_to_double(output)
    
    # AGGRESSIVE: If output doesn't start with { or [, try to find JSON in the middle
    # Also handle cases where LLM outputs garbage before/after JSON
    if not output.startswith('{') and not output.startswith('['):
        # Try to find JSON object or array in the text
        json_start = -1
        json_end = -1
        
        # Look for JSON object
        brace_start = output.find('{')
        if brace_start != -1:
            # Find matching closing brace
            depth = 0
            in_string = False
            escaped = False
            for i in range(brace_start, len(output)):
                char = output[i]
                if escaped:
                    escaped = False
                    continue
                if char == '\\':
                    escaped = True
                    continue
                if char == '"' and not in_string:
                    in_string = True
                elif char == '"' and in_string:
                    in_string = False
                elif char == '{' and not in_string:
                    depth += 1
                elif char == '}' and not in_string:
                    depth -= 1
                    if depth == 0:
                        json_start = brace_start
                        json_end = i + 1
                        break
        
        # If no valid object found, try array
        if json_start == -1:
            bracket_start = output.find('[')
            if bracket_start != -1:
                depth = 0
                in_string = False
                escaped = False
                for i in range(bracket_start, len(output)):
                    char = output[i]
                    if escaped:
                        escaped = False
                        continue
                    if char == '\\':
                        escaped = True
                        continue
                    if char == '"' and not in_string:
                        in_string = True
                    elif char == '"' and in_string:
                        in_string = False
                    elif char == '[' and not in_string:
                        depth += 1
                    elif char == ']' and not in_string:
                        depth -= 1
                        if depth == 0:
                            json_start = bracket_start
                            json_end = i + 1
                            break
        
        if json_start > 0 and json_end > json_start:
            output = output[json_start:json_end]
            print(f"DEBUG: Extracted JSON from position {json_start} to {json_end}")
    
    # Remove any trailing instructions after JSON (e.g., "Fix the above content...")
    bad_suffixes = [
        "Fix the above",
        "Generate the JSON",
        "Match the schema",
        "Correct the format"
    ]
    for suffix in bad_suffixes:
        if suffix in output:
            # Find where this instruction starts and cut it off
            idx = output.find(suffix)
            output = output[:idx].strip()
            print(f"DEBUG: Removed trailing instruction starting with '{suffix}'")
    
    # Try direct parse first
    try:
        return json.loads(output)
    except json.JSONDecodeError as e:
        # Handle "Extra data" - JSON followed by text
        if "Extra data" in str(e):
            try:
                # Find the end of the first valid JSON object
                decoder = json.JSONDecoder()
                obj, idx = decoder.raw_decode(output)
                return obj
            except:
                pass
    
    # Apply basic fixes
    try:
        fixed = fix_json_string(output)
        return json.loads(fixed)
    except json.JSONDecodeError as e:
        if "Extra data" in str(e):
            try:
                decoder = json.JSONDecoder()
                obj, idx = decoder.raw_decode(fixed)
                return obj
            except:
                pass
    
    # Extract and repair
    try:
        repaired = extract_and_repair_json(output)
        repaired = fix_json_string(repaired)
        return json.loads(repaired)
    except json.JSONDecodeError as e:
        if "Extra data" in str(e):
            try:
                decoder = json.JSONDecoder()
                obj, idx = decoder.raw_decode(repaired)
                return obj
            except:
                pass
        
        # Ultra last resort: try to extract any field:value pairs
        try:
            partial_data = {}
            # Extract "field": "value" or "field": {...}
            field_pattern = r'"(\w+)"\s*:\s*("(?:[^"\\]|\\.)*"|{[^}]*}|\[[^\]]*\]|[^,}]+)'
            matches = re.findall(field_pattern, repaired)
            for field, value in matches:
                try:
                    # Try to parse the value
                    if value.startswith('"') and value.endswith('"'):
                        partial_data[field] = value[1:-1]  # Remove quotes
                    elif value.startswith('{') or value.startswith('['):
                        partial_data[field] = json.loads(value)
                    else:
                        partial_data[field] = value.strip()
                except:
                    partial_data[field] = value.strip()
            
            if partial_data:
                return partial_data
        except:
            pass
        
        # Last resort: return a minimal error structure
        raise json.JSONDecodeError(f"Could not repair JSON: {str(e)[:100]}", output[:200], 0)

def get_text_from_response(response):
    """Extract text from the response object."""
    # Handle LangChain AIMessage directly
    if AIMessage is not None and isinstance(response, AIMessage):
        return response.content
    if 'messages' in response:
        return response['messages'][-1].content
    if 'message' in response['choices'][0]:
        return response['choices'][0]['message']['content']
    return response['choices'][0]['text']

def extract_think_and_result(info):
    "Extract think and result content from the response info."""
    think_match = re.search(r"<think>(.*?)</think>", info, re.DOTALL)
    think_content = think_match.group(1).strip() if think_match else ''
    result_content = re.sub(r"<think>.*?</think>", "", info, flags=re.DOTALL).strip()
    return think_content, result_content


def preprocess_response(response, only_text=True, exclude_think=False, json_output=False):
    if only_text or exclude_think or json_output:
        response = get_text_from_response(response)
    if exclude_think:
        think_content, result_content = extract_think_and_result(response)
        response = result_content
    if json_output:
        try:
            response = convert_json_output(response)
        except json.JSONDecodeError as e:
            print(f"Error parsing JSON output: {e}")
            response = {"error": "Invalid JSON output", "raw_content": response}
            raise e
    return response

