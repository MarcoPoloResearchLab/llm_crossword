package crosswordapi

import "testing"

func TestParseAdminEmailsFromYAML_AdditionalBranches(t *testing.T) {
	tests := []struct {
		name     string
		yamlText string
		want     []string
	}{
		{
			name: "blank yaml",
			want: []string{},
		},
		{
			name: "comments blanks and non-list items are ignored until dedent",
			yamlText: `
administrators:
  # keep this ignored

  owner: ignored
  - "Admin@example.com"
  - ""
  - 'Staff@example.com'
environments:
  - description: Local
`,
			want: []string{"admin@example.com", "staff@example.com"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseAdminEmailsFromYAML(tt.yamlText)
			if len(got) != len(tt.want) {
				t.Fatalf("expected %d emails, got %d: %v", len(tt.want), len(got), got)
			}
			for index, email := range tt.want {
				if got[index] != email {
					t.Fatalf("email[%d] = %q, want %q", index, got[index], email)
				}
			}
		})
	}
}

func TestLoadAdminEmailsFromYAMLFile_NotFound(t *testing.T) {
	_, err := LoadAdminEmailsFromYAMLFile("/definitely/missing/config.yaml")
	if err == nil {
		t.Fatal("expected file read error")
	}
}

func TestMergeAdminEmails_IgnoresBlankEntries(t *testing.T) {
	got := MergeAdminEmails(
		[]string{"admin@example.com", " ", ""},
		[]string{"ADMIN@example.com", "\t", "staff@example.com"},
	)
	want := []string{"admin@example.com", "staff@example.com"}

	if len(got) != len(want) {
		t.Fatalf("expected %d emails, got %d: %v", len(want), len(got), got)
	}
	for index, email := range want {
		if got[index] != email {
			t.Fatalf("email[%d] = %q, want %q", index, got[index], email)
		}
	}
}
