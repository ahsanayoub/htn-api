export class NextFlightDecoder {
    decode(payloads: string[]): unknown[] {
      const results: unknown[] = [];
  
      for (const payload of payloads) {
        try {
          const parsed = JSON.parse(payload);
  
          this.walk(parsed, results);
  
          // React Flight records are usually stored as strings.
          for (const value of parsed) {
            if (typeof value === "string") {
              this.decodeEmbeddedJSON(value, results);
            }
          }
        } catch {
          // ignore malformed payload
        }
      }
  
      return results;
    }
  
    private decodeEmbeddedJSON(text: string, results: unknown[]) {
      let index = 0;
  
      while (true) {
        const start = text.indexOf("{", index);
  
        if (start === -1) {
          break;
        }
  
        let depth = 0;
        let inString = false;
        let escaped = false;
  
        for (let i = start; i < text.length; i++) {
          const ch = text[i];
  
          if (escaped) {
            escaped = false;
            continue;
          }
  
          if (ch === "\\") {
            escaped = true;
            continue;
          }
  
          if (ch === '"') {
            inString = !inString;
            continue;
          }
  
          if (inString) continue;
  
          if (ch === "{") depth++;
  
          if (ch === "}") {
            depth--;
  
            if (depth === 0) {
              const candidate = text.substring(start, i + 1);
  
              try {
                const obj = JSON.parse(candidate);
  
                this.walk(obj, results);
              } catch {
                // not valid json
              }
  
              index = i + 1;
              break;
            }
          }
        }
  
        index++;
      }
    }
  
    private walk(value: unknown, results: unknown[]) {
      if (value == null) return;
  
      if (Array.isArray(value)) {
        for (const item of value) {
          this.walk(item, results);
        }
  
        return;
      }
  
      if (typeof value === "object") {
        results.push(value);
  
        for (const child of Object.values(value as Record<string, unknown>)) {
          this.walk(child, results);
        }
      }
    }
  
    find<T>(
      objects: unknown[],
      predicate: (obj: any) => boolean
    ): T | undefined {
      return objects.find(predicate) as T | undefined;
    }
  
    findAll<T>(
      objects: unknown[],
      predicate: (obj: any) => boolean
    ): T[] {
      return objects.filter(predicate) as T[];
    }
  }