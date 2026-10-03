# Credential Manager finds its Play services provider by reflection; a
# minified build must keep it (Google's Credential Manager guide).
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** {
  *;
}
